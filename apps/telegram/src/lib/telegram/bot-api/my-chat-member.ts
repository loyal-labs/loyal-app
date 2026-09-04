import { communities } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";
import type { Context } from "grammy";

import { getDatabase } from "@/lib/core/database";
import { isCommunityChat, isPrivateChat } from "@/lib/telegram/utils";

import { createBotTrackingProperties, trackBotEvent } from "./analytics";
import { sendMessageWithAutoCleanup } from "./helper-message-cleanup";
import { evictActiveCommunityCache } from "./message-handlers";
import { disableNotificationsForTelegramUser } from "./user-settings";

const ONBOARDING_MESSAGE =
  "Thanks for adding me. Run /activate_community to enable summaries for this community.\nAfter activation, summaries are available in this chat and in the app.\nUse /notifications to set notification cycles.\nUse /hide or /unhide to control public visibility.";
const BOT_ADDED_TO_GROUP_EVENT = "Bot Added to Group";
const BOT_REMOVED_FROM_GROUP_EVENT = "Bot Removed from Group";
const BOT_BLOCKED_BY_USER_EVENT = "Bot Blocked by User";
const BOT_UNBLOCKED_BY_USER_EVENT = "Bot Unblocked by User";

function isFreshJoinTransition(oldStatus: string, newStatus: string): boolean {
  const joinedFrom = oldStatus === "left" || oldStatus === "kicked";
  const joinedTo = newStatus === "member" || newStatus === "administrator";
  return joinedFrom && joinedTo;
}

function isRemovalTransition(oldStatus: string, newStatus: string): boolean {
  const removedTo = newStatus === "left" || newStatus === "kicked";
  const removedFrom =
    oldStatus === "member" ||
    oldStatus === "administrator" ||
    oldStatus === "creator" ||
    oldStatus === "restricted";
  return removedFrom && removedTo;
}

function isSupportedCommunityChat(chatType: string): boolean {
  return isCommunityChat(chatType);
}

function isPrivateBlockTransition(
  oldStatus: string,
  newStatus: string
): boolean {
  const blockedFrom = oldStatus === "member" || oldStatus === "restricted";
  const blockedTo = newStatus === "kicked";
  return blockedFrom && blockedTo;
}

function isPrivateUnblockTransition(
  oldStatus: string,
  newStatus: string
): boolean {
  const unblockedFrom = oldStatus === "kicked";
  const unblockedTo = newStatus === "member" || newStatus === "restricted";
  return unblockedFrom && unblockedTo;
}

export async function handleMyChatMemberUpdate(ctx: Context): Promise<void> {
  const myChatMemberUpdate = ctx.update.my_chat_member;
  if (!myChatMemberUpdate) {
    return;
  }

  const chatType = myChatMemberUpdate.chat.type;
  const oldStatus = myChatMemberUpdate.old_chat_member.status;
  const newStatus = myChatMemberUpdate.new_chat_member.status;
  if (isPrivateChat(chatType)) {
    const isBlockTransition = isPrivateBlockTransition(oldStatus, newStatus);
    const isUnblockTransition = isPrivateUnblockTransition(
      oldStatus,
      newStatus
    );

    if (!isBlockTransition && !isUnblockTransition) {
      return;
    }

    if (isBlockTransition) {
      try {
        const displayName = myChatMemberUpdate.from.last_name
          ? `${myChatMemberUpdate.from.first_name} ${myChatMemberUpdate.from.last_name}`
          : myChatMemberUpdate.from.first_name;
        await disableNotificationsForTelegramUser({
          displayName,
          telegramUserId: BigInt(myChatMemberUpdate.from.id),
          username: myChatMemberUpdate.from.username ?? null,
        });
      } catch (error) {
        console.error(
          "Failed to disable user notifications after block",
          error
        );
      }
    }

    const eventName = isBlockTransition
      ? BOT_BLOCKED_BY_USER_EVENT
      : BOT_UNBLOCKED_BY_USER_EVENT;
    const transitionType = isBlockTransition ? "block" : "unblock";
    trackBotEvent(eventName, {
      ...createBotTrackingProperties({
        chatId: myChatMemberUpdate.chat.id,
        chatType,
        userId: myChatMemberUpdate.from.id,
      }),
      new_status: newStatus,
      old_status: oldStatus,
      transition_type: transitionType,
    });
    return;
  }

  if (!isSupportedCommunityChat(chatType)) {
    return;
  }

  const isJoinTransition = isFreshJoinTransition(oldStatus, newStatus);
  const isRemovedTransition = isRemovalTransition(oldStatus, newStatus);

  if (!isJoinTransition && !isRemovedTransition) {
    return;
  }

  const chatId = BigInt(myChatMemberUpdate.chat.id);
  const chatTitle = myChatMemberUpdate.chat.title || "Untitled";
  const activatedBy = BigInt(myChatMemberUpdate.from.id);
  const upsertTimestamp = new Date();
  const deactivatedCommunityState = {
    chatTitle,
    isActive: false,
    isPublic: false,
    updatedAt: upsertTimestamp,
  };
  let isDatabaseOperationSuccessful = false;

  try {
    const db = getDatabase();
    if (isJoinTransition) {
      await db
        .insert(communities)
        .values({
          activatedBy,
          chatId,
          ...deactivatedCommunityState,
        })
        .onConflictDoUpdate({
          target: communities.chatId,
          set: deactivatedCommunityState,
        });
      isDatabaseOperationSuccessful = true;
    } else if (isRemovedTransition) {
      await db
        .update(communities)
        .set(deactivatedCommunityState)
        .where(eq(communities.chatId, chatId));
      isDatabaseOperationSuccessful = true;
    }
  } catch (error) {
    console.error(
      "Failed to update community state from my_chat_member update",
      error
    );
  } finally {
    evictActiveCommunityCache(chatId);
  }

  if (!isDatabaseOperationSuccessful) {
    return;
  }

  const eventName = isJoinTransition
    ? BOT_ADDED_TO_GROUP_EVENT
    : BOT_REMOVED_FROM_GROUP_EVENT;
  trackBotEvent(
    eventName,
    createBotTrackingProperties({
      chatId: myChatMemberUpdate.chat.id,
      chatType: myChatMemberUpdate.chat.type,
      userId: myChatMemberUpdate.from.id,
    })
  );

  if (!isJoinTransition) {
    return;
  }

  try {
    await sendMessageWithAutoCleanup({
      api: ctx.api,
      chatId: myChatMemberUpdate.chat.id,
      chatType: myChatMemberUpdate.chat.type,
      text: ONBOARDING_MESSAGE,
    });
  } catch (error) {
    console.error(
      "Failed to send onboarding message for my_chat_member update",
      error
    );
  }
}
