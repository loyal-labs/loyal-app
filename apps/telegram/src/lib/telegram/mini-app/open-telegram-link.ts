import { openTelegramLink } from "@telegram-apps/sdk";

import { CHANNEL_LINK } from "./constants";

export const openLoyalTgLink = async (): Promise<void> => {
  try {
    await openTelegramLink(CHANNEL_LINK);
  } catch (error) {
    console.error("Failed to open Telegram link", error);
  }
};
