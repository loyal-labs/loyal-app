import { createHash } from "node:crypto";

export function hashIdentifier(value: bigint | number | string): string {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function resolveImageExtensionFromContentType(
  contentType: string
): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();

  switch (normalized) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
    case "image/jpg":
    default:
      return "jpg";
  }
}

export function resolveUserAvatarObjectKey(
  telegramId: bigint,
  contentType: string
): string {
  const telegramIdHash = hashIdentifier(telegramId);
  const extension = resolveImageExtensionFromContentType(contentType);
  return `telegram/users/${telegramIdHash}/profile.${extension}`;
}

export function resolveCommunityPhotoObjectKey(
  chatId: number | string,
  contentType: string
): string {
  const chatIdHash = hashIdentifier(chatId);
  const extension = resolveImageExtensionFromContentType(contentType);
  return `telegram/communities/${chatIdHash}/profile.${extension}`;
}
