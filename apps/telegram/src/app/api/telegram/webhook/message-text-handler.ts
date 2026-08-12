import type { Bot, Context } from "grammy";

import { logWebhookHandlerError } from "@/lib/telegram/bot-api/webhook-error-log";

export type WebhookTextMessageHandlerDeps = {
  handleCommunityMessage: (ctx: Context) => Promise<void>;
  handleDirectMessage: (ctx: Context, bot: Bot) => Promise<void>;
  handleGLoyalReaction: (ctx: Context, bot: Bot) => Promise<void>;
  isPrivateChat: (chatType: string) => boolean;
};

export async function handleWebhookTextMessage(
  ctx: Context,
  bot: Bot,
  deps: WebhookTextMessageHandlerDeps
): Promise<void> {
  const chatType = ctx.chat?.type;

  if (chatType && deps.isPrivateChat(chatType)) {
    // Commands are handled by bot.command() handlers.
    if (!ctx.message?.text?.startsWith("/")) {
      await deps.handleDirectMessage(ctx, bot);
    }
    return;
  }

  // Community ingest is critical and must fail webhook processing for retries.
  await deps.handleCommunityMessage(ctx);

  // Reactions are non-critical and should not block message ingestion.
  void deps.handleGLoyalReaction(ctx, bot).catch((error) => {
    const updateId =
      "update_id" in ctx.update && typeof ctx.update.update_id === "number"
        ? ctx.update.update_id
        : undefined;

    logWebhookHandlerError("Failed to handle gLoyal reaction", error, {
      chatId: ctx.chat ? String(ctx.chat.id) : undefined,
      messageId: ctx.message?.message_id,
      updateId,
    });
  });
}
