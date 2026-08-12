import { etc, verify } from "@noble/ed25519";
import qs from "qs";

import { TELEGRAM_BOT_ID, TELEGRAM_PUBLIC_KEYS } from "@/lib/constants";

export const cleanInitData = (initData: string) => {
  const cleanInitData = qs.parse(initData);
  // sort the object by keys
  const sortedInitData = Object.keys(cleanInitData)
    .sort()
    .reduce((obj: Record<string, unknown>, key: string) => {
      obj[key] = cleanInitData[key as keyof typeof cleanInitData];
      return obj;
    }, {});
  return sortedInitData;
};

type ParsedTelegramUser = {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
  photo_url?: unknown;
  language_code?: unknown;
  is_premium?: unknown;
};

const parseTelegramUserField = (
  userField: unknown
): ParsedTelegramUser | null => {
  if (typeof userField === "string") {
    try {
      const parsedUser = JSON.parse(userField);
      if (parsedUser && typeof parsedUser === "object") {
        return parsedUser as ParsedTelegramUser;
      }
    } catch (error) {
      console.warn("Failed to parse Telegram user data", error);
      return null;
    }
  }

  if (typeof userField === "object" && userField !== null) {
    return userField as ParsedTelegramUser;
  }

  return null;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeTelegramId = (value: unknown): string | null => {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      return null;
    }
    return value.toString();
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }
    return normalized;
  }

  return null;
};

const normalizeOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }

  return undefined;
};

export const createValidationString = (
  botId: string,
  data: Record<string, unknown>
) => {
  const filteredEntries = Object.entries(data).filter(
    ([key]) => key !== "hash" && key !== "signature"
  );

  const formattedLines = filteredEntries.map(([key, value]) => {
    if (typeof value === "string") {
      return `${key}=${value}`;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return `${key}=${value.toString()}`;
    }
    if (typeof value === "boolean") {
      return `${key}=${value ? "true" : "false"}`;
    }
    if (value === null || value === undefined) {
      return `${key}=`;
    }
    return `${key}=${JSON.stringify(value)}`;
  });

  const validationString = [`${botId}:WebAppData`, ...formattedLines].join(
    "\n"
  );

  return validationString;
};

const decodeBase64 = (value: string): Uint8Array => {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s/g, "");
  const remainder = normalized.length % 4;
  const padded =
    remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder);

  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  throw new Error("Base64 decoding is not supported in this environment");
};

const parseSignature = (signature: string): Uint8Array => {
  const trimmed = signature.trim();
  const hexPattern = /^[0-9a-fA-F]+$/;

  if (hexPattern.test(trimmed) && trimmed.length % 2 === 0) {
    return etc.hexToBytes(trimmed);
  }

  return decodeBase64(trimmed);
};

export const validateInitData = (
  validationString: string,
  signature: string
) => {
  try {
    const message = new TextEncoder().encode(validationString);
    const signatureBytes = parseSignature(signature);

    if (signatureBytes.length !== 64) {
      console.error(
        "Invalid signature length:",
        signatureBytes.length,
        "expected: 64"
      );
      return false;
    }

    const result = TELEGRAM_PUBLIC_KEYS.some((publicKeyHex) => {
      const publicKeyBytes = etc.hexToBytes(publicKeyHex);

      if (publicKeyBytes.length !== 32) {
        console.error(
          "Invalid public key length:",
          publicKeyBytes.length,
          "expected: 32"
        );
        return false;
      }

      const isValid = verify(signatureBytes, message, publicKeyBytes);
      return isValid;
    });

    return result;
  } catch (error) {
    console.error("Failed to validate Telegram init data", error);
    return false;
  }
};

export const createValidationBytesFromRawInitData = (
  rawInitData: string
): { validationBytes: Uint8Array; signatureBytes: Uint8Array } => {
  if (!TELEGRAM_BOT_ID) {
    throw new Error("NEXT_PUBLIC_TELEGRAM_BOT_ID is not set in .env");
  }
  const cleanData = cleanInitData(rawInitData);
  const validationString = createValidationString(TELEGRAM_BOT_ID, cleanData);
  const validationBytes = new TextEncoder().encode(validationString);
  const signatureBytes = parseSignature(cleanData.signature as string);

  return { validationBytes, signatureBytes };
};

export const parseUsernameFromInitData = (
  initData: Record<string, unknown>
): string | null => {
  const user = parseTelegramUserField(initData["user"]);
  const parsedUsername = normalizeOptionalString(user?.username);
  if (parsedUsername) {
    return parsedUsername;
  }

  const usernameField = initData["username"];
  const fallbackUsername = normalizeOptionalString(usernameField);
  if (fallbackUsername) {
    return fallbackUsername;
  }

  return null;
};

export type TelegramIdentity = {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
  isPremium?: boolean;
};

export type TelegramLaunchContext = {
  startParamRaw?: string;
  chatType?: string;
  chatInstance?: string;
};

export type TelegramAnalyticsContext = {
  identity: TelegramIdentity | null;
  launchContext: TelegramLaunchContext;
};

export type UserData = {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
  isPremium?: boolean;
};

const parseTelegramIdentityFromCleanInitData = (
  cleanData: Record<string, unknown>
): TelegramIdentity | null => {
  const user = parseTelegramUserField(cleanData["user"]);
  if (!user) {
    return null;
  }

  const telegramId = normalizeTelegramId(user.id);
  if (!telegramId) {
    return null;
  }

  return {
    telegramId,
    firstName: normalizeOptionalString(user.first_name) ?? "User",
    lastName: normalizeOptionalString(user.last_name),
    username: normalizeOptionalString(user.username),
    photoUrl: normalizeOptionalString(user.photo_url),
    languageCode: normalizeOptionalString(user.language_code),
    isPremium: normalizeOptionalBoolean(user.is_premium),
  };
};

const parseTelegramLaunchContextFromCleanInitData = (
  cleanData: Record<string, unknown>
): TelegramLaunchContext => ({
  startParamRaw: normalizeOptionalString(cleanData["start_param"]),
  chatType: normalizeOptionalString(cleanData["chat_type"]),
  chatInstance: normalizeOptionalString(cleanData["chat_instance"]),
});

export function parseTelegramAnalyticsContextFromInitData(
  rawInitData: string | undefined
): TelegramAnalyticsContext | null {
  if (!rawInitData) return null;

  try {
    const cleanData = cleanInitData(rawInitData);
    return {
      identity: parseTelegramIdentityFromCleanInitData(cleanData),
      launchContext: parseTelegramLaunchContextFromCleanInitData(cleanData),
    };
  } catch (error) {
    console.warn("Failed to parse user data from initData", error);
    return null;
  }
}

export function parseTelegramIdentityFromInitData(
  rawInitData: string | undefined
): TelegramIdentity | null {
  return (
    parseTelegramAnalyticsContextFromInitData(rawInitData)?.identity ?? null
  );
}

export function parseUserFromInitData(
  rawInitData: string | undefined
): UserData | null {
  const identity = parseTelegramIdentityFromInitData(rawInitData);
  if (!identity) {
    return null;
  }

  return {
    telegramId: identity.telegramId,
    firstName: identity.firstName,
    lastName: identity.lastName,
    username: identity.username,
    photoUrl: identity.photoUrl,
    languageCode: identity.languageCode,
    isPremium: identity.isPremium,
  };
}
