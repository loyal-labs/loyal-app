import { InlineKeyboard } from "grammy";

import { resolveEndpoint } from "@/lib/core/api";
import { MINI_APP_LINK } from "@/lib/telegram/constants";

import { getBot } from "./bot";
import { isNotificationsEnabledForTelegramUser } from "./user-settings";

const buildOgImageUrl = (
  sender: string,
  receiver: string,
  solAmount: number,
  usdAmount: number
): string => {
  const endpoint = resolveEndpoint("api/og/share");
  const url = new URL(endpoint);
  url.searchParams.set("sender", sender);
  url.searchParams.set("receiver", receiver);
  url.searchParams.set("solAmount", solAmount.toString());
  url.searchParams.set("usdAmount", usdAmount.toString());
  return url.toString();
};

export const sendTransactionNotification = async (
  userId: number,
  senderUsername: string,
  receiverUsername: string,
  solAmount: number,
  usdAmount: number
): Promise<void> => {
  const notificationsEnabled = await isNotificationsEnabledForTelegramUser(
    BigInt(userId)
  );
  if (!notificationsEnabled) {
    return;
  }

  const bot = await getBot();
  const photoUrl = buildOgImageUrl(
    senderUsername,
    receiverUsername,
    solAmount,
    usdAmount
  );

  const invisibleChar = String.fromCharCode(0x200b);
  const text = `You received <b>${solAmount} SOL</b> from <b>${senderUsername}</b>!\n\nTap the button below to claim your funds.<a href="${photoUrl}">${invisibleChar}</a>`;

  const keyboard = new InlineKeyboard().url("Claim Now", MINI_APP_LINK);

  await bot.api.sendMessage(userId, text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
    link_preview_options: {
      url: photoUrl,
      prefer_large_media: true,
      show_above_text: true,
    },
  });
};
