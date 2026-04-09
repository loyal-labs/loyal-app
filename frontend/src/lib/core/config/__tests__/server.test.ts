import { beforeAll, describe, expect, mock, test } from "bun:test";
import { PROGRAM_ADDRESS } from "@loyal-labs/loyal-smart-accounts";

mock.module("server-only", () => ({}));

let createServerEnv: typeof import("../server").createServerEnv;

describe("server config", () => {
  beforeAll(async () => {
    process.env.PHALA_API_KEY = "bootstrap-key";
    ({ createServerEnv } = await import("../server"));
    delete process.env.PHALA_API_KEY;
  });

  test("uses prod as the default app environment", () => {
    expect(
      createServerEnv({
        PHALA_API_KEY: "server-key",
        DATABASE_URL: "postgresql://localhost/test",
      }).appEnvironment
    ).toBe("prod");
  });

  test("accepts valid app environment values", () => {
    const env = createServerEnv({
      NEXT_PUBLIC_APP_ENVIRONMENT: "dev",
      PHALA_API_KEY: "server-key",
      DATABASE_URL: "postgresql://localhost/test",
    });

    expect(env.appEnvironment).toBe("dev");
  });

  test("falls back to prod for invalid app environment values", () => {
    const env = createServerEnv({
      NEXT_PUBLIC_APP_ENVIRONMENT: "qa",
      PHALA_API_KEY: "server-key",
      DATABASE_URL: "postgresql://localhost/test",
    });

    expect(env.appEnvironment).toBe("prod");
  });

  test("throws when the required Phala API key is missing", () => {
    expect(() => createServerEnv({})).toThrow("PHALA_API_KEY is not set");
  });

  test("returns a centralized chat runtime config", () => {
    const env = createServerEnv({
      PHALA_API_KEY: "  phala-key  ",
      PHALA_MODEL_ID: "  loyal-model  ",
      DATABASE_URL: "postgresql://localhost/test",
    });

    expect(env.chatRuntime).toEqual({
      apiKey: "phala-key",
      modelId: "loyal-model",
    });
  });

  test("defaults the server solana environment and loyal smart-account program id", () => {
    const env = createServerEnv({
      PHALA_API_KEY: "server-key",
      DATABASE_URL: "postgresql://localhost/test",
    });

    expect(env.solanaEnv).toBe("devnet");
    expect(env.loyalSmartAccounts.programId).toBe(PROGRAM_ADDRESS);
  });

  test("prefers env-specific loyal smart-account program ids", () => {
    const env = createServerEnv({
      PHALA_API_KEY: "server-key",
      DATABASE_URL: "postgresql://localhost/test",
      NEXT_PUBLIC_SOLANA_ENV: "mainnet",
      LOYAL_SMART_ACCOUNTS_PROGRAM_ID:
        "11111111111111111111111111111111",
      LOYAL_SMART_ACCOUNTS_PROGRAM_ID_MAINNET:
        "Stake11111111111111111111111111111111111111",
    });

    expect(env.solanaEnv).toBe("mainnet");
    expect(env.loyalSmartAccounts.programId).toBe(
      "Stake11111111111111111111111111111111111111"
    );
  });
});
