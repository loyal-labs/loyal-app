import { File } from "grammy/types";

import { serverEnv } from "@/lib/core/config/server";

import { getBot } from "./bot";

export type DownloadedTelegramFile = {
  body: Buffer;
  contentType: string;
};

const getFileId = async (fileId: string): Promise<File> => {
  const bot = await getBot();
  const file = await bot.api.getFile(fileId);
  return file;
};

export const getFileUrl = async (fileId: string): Promise<string> => {
  const file = await getFileId(fileId);
  return `https://api.telegram.org/file/bot${serverEnv.askLoyalBotToken}/${file.file_path}`;
};

export const downloadTelegramFile = async (
  fileId: string
): Promise<DownloadedTelegramFile> => {
  const fileUrl = await getFileUrl(fileId);
  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch Telegram file: ${response.status}`);
  }

  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType:
      response.headers.get("content-type") || "application/octet-stream",
  };
};
