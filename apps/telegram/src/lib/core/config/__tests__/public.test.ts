import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { publicEnv } from "../public";

const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_APP_ENVIRONMENT",
  "NEXT_PUBLIC_SERVER_HOST",
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

  test("falls back to prod for invalid app environment values", () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "staging";
    expect(publicEnv.appEnvironment).toBe("prod");
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
});
