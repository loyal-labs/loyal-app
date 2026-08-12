import { setEmojiStatus } from "@telegram-apps/sdk";

import { CUSTOM_EMOJI_ID } from "../bot-api/constants";
import { isInMiniApp } from ".";

const canSetEmojiStatus = (): boolean => {
  if (!isInMiniApp()) return false;
  return setEmojiStatus.isSupported();
};

export const setUserEmojiStatus = async (emojiId: string): Promise<boolean> => {
  if (!canSetEmojiStatus()) return false;
  try {
    return await setEmojiStatus(emojiId);
  } catch (error) {
    console.error("Failed to set emoji status", error);
    return false;
  }
};

export const setLoyalEmojiStatus = async (): Promise<boolean> => {
  if (!canSetEmojiStatus()) return false;
  try {
    return await setEmojiStatus(CUSTOM_EMOJI_ID);
  } catch (error) {
    console.error("Failed to set emoji status", error);
    return false;
  }
};
