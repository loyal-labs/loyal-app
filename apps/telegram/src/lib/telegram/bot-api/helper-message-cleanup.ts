import { telegramHelperMessageCleanup } from "@loyal-labs/db-core/schema";
import type { CommandContext, Context } from "grammy";

import { getDatabase } from "@/lib/core/database";
import { isCommunityChat } from "@/lib/telegram/utils";

const DEFAULT_HELPER_MESSAGE_TTL_MS = 60_000;

type ReplyContext = Pick<CommandContext<Context>, "chat" | "reply">;
type ReplyOptions = Parameters<ReplyContext["reply"]>[1];
type SendMessageApi = Pick<Context["api"], "sendMessage">;
type SendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];

export async function scheduleHelperMessageDeletion(
  chatId: bigint | number | string,
  messageId: number,
  ttlMs: number = DEFAULT_HELPER_MESSAGE_TTL_MS
): Promise<void> {
  try {
    const db = getDatabase();
    const now = Date.now();
    const deleteAfter = new Date(now + Math.max(ttlMs, 0));

    await db
      .insert(telegramHelperMessageCleanup)
      .values({
        chatId: BigInt(chatId),
        deleteAfter,
        messageId,
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error("Failed to schedule helper message cleanup", {
      chatId: String(chatId),
      error: error instanceof Error ? error.message : String(error),
      messageId,
      ttlMs,
    });
  }
}

export async function replyWithAutoCleanup(
  ctx: ReplyContext,
  text: string,
  options?: ReplyOptions
): Promise<void> {
  const message = await ctx.reply(text, options);
  if (!message || typeof message.message_id !== "number") {
    return;
  }

  if (!ctx.chat || !isCommunityChat(ctx.chat.type)) {
    return;
  }

  await scheduleHelperMessageDeletion(ctx.chat.id, message.message_id);
}

export async function sendMessageWithAutoCleanup(params: {
  api: SendMessageApi;
  chatId: number | string;
  chatType: string;
  options?: SendMessageOptions;
  text: string;
}): Promise<void> {
  const message = await params.api.sendMessage(
    params.chatId,
    params.text,
    params.options
  );
  if (!message || typeof message.message_id !== "number") {
    return;
  }

  if (!isCommunityChat(params.chatType)) {
    return;
  }

  await scheduleHelperMessageDeletion(params.chatId, message.message_id);
}
