import {
  getCloudflareCdnBaseUrlFromEnv,
  getCloudflareCdnUrlClientFromEnv,
} from "@/lib/core/cdn-url";
import {
  getCloudflareR2UploadClientFromEnv,
  isCloudflareR2UploadConfigured,
} from "@/lib/core/r2-upload";
import { getChat } from "@/lib/telegram/bot-api/get-chat";
import { downloadTelegramFile } from "@/lib/telegram/bot-api/get-file";
import { resolveCommunityPhotoObjectKey as resolveCommunityPhotoObjectKeyFromPath } from "@/lib/telegram/photo-path";

const COMMUNITY_CAPTURE_TIMEOUT_MS = 2500;

type CaptureCommunityPhotoOptions = {
  timeoutMs?: number;
};

export function resolveCommunityPhotoObjectKey(
  chatId: number | string,
  contentType: string
): string {
  // Backward-compatible wrapper kept for existing tests/import sites.
  return resolveCommunityPhotoObjectKeyFromPath(chatId, contentType);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `Telegram community photo capture timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function captureCommunityPhotoToCdnInternal(
  chatId: number | string
): Promise<string | null> {
  if (!isCloudflareR2UploadConfigured() || !getCloudflareCdnBaseUrlFromEnv()) {
    return null;
  }

  const chatInfo = await getChat(chatId);
  const smallFileId = chatInfo.photo?.small_file_id;

  if (!smallFileId) {
    return null;
  }

  const photoFile = await downloadTelegramFile(smallFileId);
  const key = resolveCommunityPhotoObjectKeyFromPath(
    chatId,
    photoFile.contentType
  );

  await getCloudflareR2UploadClientFromEnv().uploadImage({
    key,
    body: photoFile.body,
    contentType: photoFile.contentType,
  });

  return getCloudflareCdnUrlClientFromEnv().resolveUrl({ key });
}

export async function captureCommunityPhotoToCdn(
  chatId: number | string,
  options?: CaptureCommunityPhotoOptions
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? COMMUNITY_CAPTURE_TIMEOUT_MS;

  try {
    return await withTimeout(
      captureCommunityPhotoToCdnInternal(chatId),
      timeoutMs
    );
  } catch (error) {
    console.warn("Failed to capture Telegram community photo", {
      chatId: String(chatId),
      error,
    });
    return null;
  }
}
