import { InlineKeyboard, InlineQueryResultBuilder } from "grammy";
import { PreparedInlineMessage } from "grammy/types";

import { MINI_APP_LINK } from "@/lib/telegram/constants";

import { getBot } from "./bot";

export const prepareInlineMessage = async (
  userId: number,
  photoUrl: string,
  senderUsername: string,
  receiverUsername: string,
  solAmount: number,
  isSecure?: boolean
): Promise<PreparedInlineMessage> => {
  const bot = await getBot();
  const invisibleUnicodeSymbol = String.fromCharCode(0x200b);
  const tokenLabel = isSecure ? "Secure SOL" : "SOL";
  const text = `Hi ${receiverUsername}!\n\nYou received <b>${solAmount} ${tokenLabel}</b> from <b>${senderUsername}</b>.\n\nTap the button below the image to get your money!<a href="${photoUrl}">${invisibleUnicodeSymbol}</a>`;
  const buttonText = "CLICK HERE TO CLAIM";

  const keyboard = new InlineKeyboard()
    .url("⬇️⬇️⬇️", MINI_APP_LINK)
    .row()
    .url(buttonText, MINI_APP_LINK)
    .row()
    .url("⬆️⬆️⬆️", MINI_APP_LINK);

  const inlineMessage = InlineQueryResultBuilder.article(
    "id0",
    "Tap to open Loyal app and claim the transaction!",
    {
      reply_markup: keyboard,
      url: photoUrl,
      thumbnail_url: photoUrl,
    }
  ).text(text, { parse_mode: "HTML" });

  const preparedInlineMessage = await bot.api.savePreparedInlineMessage(
    userId,
    inlineMessage,
    {
      allow_bot_chats: false,
      allow_channel_chats: false,
      allow_group_chats: false,
      allow_user_chats: true,
    }
  );

  return preparedInlineMessage;
};
