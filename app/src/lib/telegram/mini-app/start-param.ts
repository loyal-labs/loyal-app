import { MINI_APP_LINK } from "@/lib/telegram/constants";

const START_PARAM_PREFIX = "sf1";
const START_PARAM_MAX_LENGTH = 64;
const START_PARAM_ALLOWED_CHARS_REGEX = /^[A-Za-z0-9_-]+$/;
const TELEGRAM_CHAT_ID_REGEX = /^-?\d+$/;
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ParsedSummaryFeedStartParam = {
  groupChatId: string;
  summaryId: string;
  version: "sf1";
};

function normalizeStringValue(value: bigint | number | string): string {
  if (typeof value === "string") {
    return value.trim();
  }

  return String(value);
}

function isValidTelegramChatId(value: string): boolean {
  return TELEGRAM_CHAT_ID_REGEX.test(value);
}

function isValidSummaryId(value: string): boolean {
  return UUID_REGEX.test(value);
}

function isValidStartParamEnvelope(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= START_PARAM_MAX_LENGTH &&
    START_PARAM_ALLOWED_CHARS_REGEX.test(value)
  );
}

export function buildSummaryFeedStartParam(
  groupChatId: bigint | number | string,
  summaryId: string
): string {
  const normalizedGroupChatId = normalizeStringValue(groupChatId);
  const normalizedSummaryId = summaryId.trim();

  if (!isValidTelegramChatId(normalizedGroupChatId)) {
    throw new Error("Invalid Telegram group chat id for start param");
  }

  if (!isValidSummaryId(normalizedSummaryId)) {
    throw new Error("Invalid summary id for start param");
  }

  const startParam = `${START_PARAM_PREFIX}_${normalizedGroupChatId}_${normalizedSummaryId}`;

  if (!isValidStartParamEnvelope(startParam)) {
    throw new Error("Start param exceeds Telegram limits");
  }

  return startParam;
}

export function parseSummaryFeedStartParam(
  raw: string | null | undefined
): ParsedSummaryFeedStartParam | null {
  if (!raw) {
    return null;
  }

  const normalizedRaw = raw.trim();
  if (!isValidStartParamEnvelope(normalizedRaw)) {
    return null;
  }

  const parts = normalizedRaw.split("_");
  if (parts.length !== 3) {
    return null;
  }

  const [prefix, groupChatId, summaryId] = parts;
  if (prefix !== START_PARAM_PREFIX) {
    return null;
  }

  if (!isValidTelegramChatId(groupChatId) || !isValidSummaryId(summaryId)) {
    return null;
  }

  return {
    groupChatId,
    summaryId,
    version: "sf1",
  };
}

export function buildSummaryFeedMiniAppUrl(
  groupChatId: bigint | number | string,
  summaryId: string
): string {
  const startParam = buildSummaryFeedStartParam(groupChatId, summaryId);
  return `${MINI_APP_LINK}?startapp=${encodeURIComponent(startParam)}`;
}

// --- Verification deeplink ("vr_<telegramUserId>") ---

const VERIFY_START_PARAM_PREFIX = "vr_";
const VERIFY_USER_ID_REGEX = /^\d+$/;

export function parseVerifyStartParam(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith(VERIFY_START_PARAM_PREFIX)) return null;
  const userId = trimmed.slice(VERIFY_START_PARAM_PREFIX.length);
  if (!VERIFY_USER_ID_REGEX.test(userId)) return null;
  return userId;
}

export function isVerifyStartParam(raw: string | null | undefined): boolean {
  return parseVerifyStartParam(raw) !== null;
}

export function buildVerifyMiniAppUrl(userId: string | number): string {
  return `${MINI_APP_LINK}?startapp=vr_${userId}`;
}
