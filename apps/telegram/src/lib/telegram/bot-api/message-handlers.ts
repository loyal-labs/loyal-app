import { communityMembers, messages } from "@loyal-labs/db-core/schema";
import type { Bot, Context } from "grammy";

import { getDatabase } from "@/lib/core/database";
import { getOrCreateUser } from "@/lib/telegram/user-service";
import {
  getTelegramDisplayName,
  isCommunityChat,
  isGroupChat,
} from "@/lib/telegram/utils";

import { resolveActiveBotCommunityId } from "./active-community-cache";
import { logWebhookHandlerError } from "./webhook-error-log";

export { evictActiveCommunityCache } from "./active-community-cache";

const POSITIVE_REACTIONS = [
  "❤",
  "🔥",
  "🎉",
  "🤩",
  "🙏",
  "😍",
  "❤‍🔥",
  "💯",
  "⚡",
] as const;

const GLOYAL_TRIGGER = "gloyal";

function pickRandomReaction(): (typeof POSITIVE_REACTIONS)[number] {
  const index = Math.floor(Math.random() * POSITIVE_REACTIONS.length);
  return POSITIVE_REACTIONS[index];
}

export async function handleGLoyalReaction(
  ctx: Context,
  bot: Bot
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;
  if (!text.toLowerCase().includes(GLOYAL_TRIGGER)) return;

  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  const chatType = ctx.chat?.type;
  if (!chatType || !isGroupChat(chatType)) return;
  if (!chatId || !messageId) {
    console.error("Chat ID or message ID not found for gLoyal reaction");
    return;
  }

  const emoji = pickRandomReaction();
  await bot.api.setMessageReaction(chatId, messageId, [
    {
      type: "emoji",
      emoji,
    },
  ]);
}

export async function handleCommunityMessage(ctx: Context): Promise<void> {
  const chat = ctx.chat;
  if (!chat) return;
  if (!isCommunityChat(chat.type)) return;

  const chatId = BigInt(chat.id);
  const message = ctx.message;
  if (!message?.text || !message.from) return;
  const updateId =
    "update_id" in ctx.update && typeof ctx.update.update_id === "number"
      ? ctx.update.update_id
      : undefined;

  try {
    const db = getDatabase();

    const communityId = await resolveActiveBotCommunityId(db, chatId);
    if (!communityId) return;

    const telegramUserId = BigInt(message.from.id);
    const displayName = getTelegramDisplayName(message.from);

    // Get or create user
    const userId = await getOrCreateUser(telegramUserId, {
      username: message.from.username || null,
      displayName,
    });

    // Ensure community membership exists (use onConflictDoNothing for race condition safety)
    await db
      .insert(communityMembers)
      .values({
        communityId,
        userId,
      })
      .onConflictDoNothing();

    // Store message (use onConflictDoNothing for duplicate message handling)
    await db
      .insert(messages)
      .values({
        communityId,
        userId,
        telegramMessageId: BigInt(message.message_id),
        content: message.text,
      })
      .onConflictDoNothing();
  } catch (error) {
    logWebhookHandlerError("Failed to handle community message", error, {
      chatId: String(chatId),
      messageId: message.message_id,
      telegramUserId: String(message.from.id),
      updateId,
    });
    throw error;
  }
}
