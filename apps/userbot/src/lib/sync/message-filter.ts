import type { IngestibleMessage, MessageFilterStats } from "./types";

type TelegramMessageLike = {
  date: Date;
  id: number;
  isService: boolean;
  media: { type: string } | null;
  sender?: {
    displayName?: string | null;
    id: number;
    type: string;
    username?: string | null;
  } | null;
  text: string;
};

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function toTelegramMessageLike(
  rawMessage: unknown
): TelegramMessageLike | null {
  if (!rawMessage || typeof rawMessage !== "object") {
    return null;
  }

  const candidate = rawMessage as {
    date?: unknown;
    id?: unknown;
    isService?: unknown;
    media?: unknown;
    sender?: unknown;
    text?: unknown;
  };

  if (!Number.isInteger(candidate.id) || (candidate.id as number) <= 0) {
    return null;
  }
  if (!isValidDate(candidate.date)) {
    return null;
  }
  if (typeof candidate.isService !== "boolean") {
    return null;
  }
  if (typeof candidate.text !== "string") {
    return null;
  }

  const normalizedMedia =
    candidate.media === null
      ? null
      : candidate.media &&
        typeof candidate.media === "object" &&
        typeof (candidate.media as { type?: unknown }).type === "string"
      ? ({ type: (candidate.media as { type: string }).type } as const)
      : null;

  let normalizedSender: TelegramMessageLike["sender"] = null;
  if (candidate.sender && typeof candidate.sender === "object") {
    const sender = candidate.sender as {
      displayName?: unknown;
      id?: unknown;
      type?: unknown;
      username?: unknown;
    };

    if (typeof sender.type === "string" && Number.isInteger(sender.id)) {
      normalizedSender = {
        displayName:
          typeof sender.displayName === "string" ? sender.displayName : null,
        id: sender.id as number,
        type: sender.type,
        username: typeof sender.username === "string" ? sender.username : null,
      };
    }
  }

  return {
    date: candidate.date,
    id: candidate.id as number,
    isService: candidate.isService,
    media: normalizedMedia,
    sender: normalizedSender,
    text: candidate.text,
  };
}

function isSupportedTextMessage(message: TelegramMessageLike): boolean {
  if (message.isService) {
    return false;
  }

  const trimmedText = message.text.trim();
  if (trimmedText.length === 0) {
    return false;
  }

  return message.media === null || message.media.type === "webpage";
}

export function toIngestibleMessage(
  rawMessage: unknown,
  stats: MessageFilterStats
): IngestibleMessage | null {
  const message = toTelegramMessageLike(rawMessage);
  if (!message) {
    stats.skippedUnsupportedShape += 1;
    return null;
  }

  if (!isSupportedTextMessage(message)) {
    stats.skippedNonText += 1;
    return null;
  }

  const sender = message.sender;
  if (!sender || sender.type !== "user") {
    stats.skippedNonUserSender += 1;
    return null;
  }

  const senderDisplayName =
    typeof sender.displayName === "string" &&
    sender.displayName.trim().length > 0
      ? sender.displayName.trim()
      : `User ${sender.id}`;

  return {
    content: message.text.trim(),
    createdAt: message.date,
    messageId: message.id,
    senderDisplayName,
    senderTelegramId: BigInt(sender.id),
    senderUsername: sender.username ?? null,
  };
}
