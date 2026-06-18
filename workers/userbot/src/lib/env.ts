import { resolve } from "node:path";

export const DEFAULT_ACCOUNT_KEY = "primary";
export const DEFAULT_STORAGE_DIR = "/var/data/userbot";

const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

type EnvRecord = Record<string, string | undefined>;

export type UserbotAuthMode = "bot" | "user";

export type UserbotConfig = {
  accountKey: string;
  authMode: UserbotAuthMode;
  apiHash: string;
  apiId: number;
  botToken: string | null;
  storageDir: string;
};

function normalizeOptionalValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getRequiredEnv(name: string, env: EnvRecord): string {
  const value = normalizeOptionalValue(env[name]);
  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

function parseApiId(rawApiId: string): number {
  const parsed = Number.parseInt(rawApiId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("TELEGRAM_USERBOT_API_ID must be a positive integer");
  }

  return parsed;
}

function parseAccountKey(rawAccountKey: string | undefined): string {
  const normalized =
    normalizeOptionalValue(rawAccountKey) ?? DEFAULT_ACCOUNT_KEY;

  if (!ACCOUNT_KEY_PATTERN.test(normalized)) {
    throw new Error(
      "TELEGRAM_USERBOT_ACCOUNT_KEY must match /^[A-Za-z0-9_-]+$/"
    );
  }

  return normalized;
}

function parseStorageDir(rawStorageDir: string | undefined): string {
  const normalized =
    normalizeOptionalValue(rawStorageDir) ?? DEFAULT_STORAGE_DIR;
  return resolve(normalized);
}

function parseBotToken(env: EnvRecord): string | null {
  const explicitBotToken = normalizeOptionalValue(
    env.TELEGRAM_USERBOT_BOT_TOKEN
  );
  if (explicitBotToken) {
    return explicitBotToken;
  }

  const askLoyalBotToken = normalizeOptionalValue(env.ASKLOYAL_TGBOT_KEY);
  if (askLoyalBotToken) {
    return askLoyalBotToken;
  }

  return null;
}

export function loadUserbotConfig(env: EnvRecord = process.env): UserbotConfig {
  const apiId = parseApiId(getRequiredEnv("TELEGRAM_USERBOT_API_ID", env));
  const apiHash = getRequiredEnv("TELEGRAM_USERBOT_API_HASH", env);
  const botToken = parseBotToken(env);

  return {
    accountKey: parseAccountKey(env.TELEGRAM_USERBOT_ACCOUNT_KEY),
    authMode: botToken ? "bot" : "user",
    apiHash,
    apiId,
    botToken,
    storageDir: parseStorageDir(env.USERBOT_STORAGE_DIR),
  };
}

export function readBootstrapPhone(
  env: EnvRecord = process.env
): string | undefined {
  return normalizeOptionalValue(env.TELEGRAM_USERBOT_PHONE);
}
