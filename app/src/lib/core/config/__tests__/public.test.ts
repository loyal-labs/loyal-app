import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { publicEnv } from "../public";

const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_APP_ENVIRONMENT",
  "NEXT_PUBLIC_SERVER_HOST",
  "NEXT_PUBLIC_GRID_AUTH_BASE_URL",
  "NEXT_PUBLIC_TELEGRAM_BOT_ID",
  "NEXT_PUBLIC_SOLANA_ENV",
  "NEXT_PUBLIC_GAS_PUBLIC_KEY",
  "NEXT_PUBLIC_USE_MOCK_SUMMARIES",
  "NEXT_PUBLIC_MIXPANEL_TOKEN",
  "NEXT_PUBLIC_MIXPANEL_PROXY_PATH",
  "NEXT_PUBLIC_GIT_BRANCH",
  "NEXT_PUBLIC_GIT_COMMIT_HASH",
] as const;

function clearPublicEnv(): void {
  for (const key of PUBLIC_ENV_KEYS) {
    delete process.env[key];
  }
}

describe("public config", () => {
  beforeEach(() => {
    clearPublicEnv();
  });

  afterEach(() => {
    clearPublicEnv();
  });

  test("uses prod as the default app environment", () => {
    expect(publicEnv.appEnvironment).toBe("prod");
  });

  test("accepts valid app environment values", () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "local";
    expect(publicEnv.appEnvironment).toBe("local");
  });

  test("falls back to prod for invalid app environment values", () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "staging";
    expect(publicEnv.appEnvironment).toBe("prod");
  });

  test("returns trimmed optional values", () => {
    process.env.NEXT_PUBLIC_SERVER_HOST = "  https://example.com  ";
    process.env.NEXT_PUBLIC_GRID_AUTH_BASE_URL = "  https://auth.askloyal.com  ";
    process.env.NEXT_PUBLIC_GAS_PUBLIC_KEY = "  gas-key  ";

    expect(publicEnv.serverHost).toBe("https://example.com");
    expect(publicEnv.gridAuthBaseUrl).toBe("https://auth.askloyal.com");
    expect(publicEnv.gasPublicKey).toBe("gas-key");
  });

  test("returns empty telegram bot id by default", () => {
    expect(publicEnv.telegramBotId).toBe("");
  });

  test("returns trimmed telegram bot id when set", () => {
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID = "  bot-id  ";
    expect(publicEnv.telegramBotId).toBe("bot-id");
  });

  test("uses devnet as default solana env", () => {
    expect(publicEnv.solanaEnv).toBe("devnet");
  });

  test("accepts valid solana env values", () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "mainnet";
    expect(publicEnv.solanaEnv).toBe("mainnet");
  });

  test("falls back to devnet for invalid solana env values", () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "staging";
    expect(publicEnv.solanaEnv).toBe("devnet");
  });

  test("parses boolean values with strict true semantics", () => {
    process.env.NEXT_PUBLIC_USE_MOCK_SUMMARIES = "true";
    expect(publicEnv.useMockSummaries).toBe(true);

    process.env.NEXT_PUBLIC_USE_MOCK_SUMMARIES = "TRUE";
    expect(publicEnv.useMockSummaries).toBe(false);
  });

  test("returns trimmed mixpanel config and git metadata", () => {
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN = "  token  ";
    process.env.NEXT_PUBLIC_MIXPANEL_PROXY_PATH = " ingest-custom ";
    process.env.NEXT_PUBLIC_GIT_BRANCH = "  test-branch  ";
    process.env.NEXT_PUBLIC_GIT_COMMIT_HASH = "  abcdef1  ";

    expect(publicEnv.mixpanelToken).toBe("token");
    expect(publicEnv.mixpanelProxyPath).toBe("/ingest-custom");
    expect(publicEnv.gitBranch).toBe("test-branch");
    expect(publicEnv.gitCommitHash).toBe("abcdef1");
  });

  test("defaults mixpanel proxy path and git metadata when unset", () => {
    expect(publicEnv.mixpanelProxyPath).toBe("/ingest");
    expect(publicEnv.gitBranch).toBe("unknown");
    expect(publicEnv.gitCommitHash).toBe("unknown");
  });
});
