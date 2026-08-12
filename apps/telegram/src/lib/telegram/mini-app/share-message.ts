import { isShareMessageError, shareMessage } from "@telegram-apps/sdk";

import { resolveEndpoint } from "@/lib/core/api";

import { isInMiniApp } from ".";

const canShareMessage = (): boolean => {
  if (!isInMiniApp()) return false;
  return shareMessage.isSupported();
};

export const createShareMessage = async (
  rawInitData: string,
  receiverUsername: string,
  solAmount: number,
  usdAmount: number,
  isSecure?: boolean
): Promise<string> => {
  const endpoint = resolveEndpoint("/api/telegram/share");
  const body = JSON.stringify({
    rawInitData,
    receiverUsername,
    solAmount,
    usdAmount,
    isSecure,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(
      `Failed to create share message: ${response.status} ${response.statusText}`
    );
  }
  const data = await response.json();
  if (!data.msgId) {
    throw new Error("Failed to create share message: msgId is missing");
  }
  return data.msgId;
};

export const shareSavedInlineMessage = async (
  msgId: string
): Promise<boolean> => {
  if (!canShareMessage()) return false;
  try {
    await shareMessage(msgId);
    return true;
  } catch (error) {
    if (isShareMessageError(error)) {
      console.warn("User declined to share message");
    } else {
      console.error("Failed to share message", error);
    }
    return false;
  }
};
