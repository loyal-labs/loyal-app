import { describe, expect, test } from "bun:test";

import { loadUserbotConfig } from "../lib/env";

describe("loadUserbotConfig", () => {
  test("throws deterministic error when TELEGRAM_USERBOT_API_ID is missing", () => {
    expect(() =>
      loadUserbotConfig({
        TELEGRAM_USERBOT_API_HASH: "hash",
      })
    ).toThrow("TELEGRAM_USERBOT_API_ID is not set");
  });

  test("throws deterministic error when TELEGRAM_USERBOT_API_HASH is missing", () => {
    expect(() =>
      loadUserbotConfig({
        TELEGRAM_USERBOT_API_ID: "123",
      })
    ).toThrow("TELEGRAM_USERBOT_API_HASH is not set");
  });

  test("prefers TELEGRAM_USERBOT_BOT_TOKEN for bot auth mode", () => {
    const config = loadUserbotConfig({
      ASKLOYAL_TGBOT_KEY: "fallback-token",
      TELEGRAM_USERBOT_API_HASH: "hash",
      TELEGRAM_USERBOT_API_ID: "123",
      TELEGRAM_USERBOT_BOT_TOKEN: "preferred-token",
    });

    expect(config.authMode).toBe("bot");
    expect(config.botToken).toBe("preferred-token");
  });

  test("falls back to ASKLOYAL_TGBOT_KEY for bot auth mode", () => {
    const config = loadUserbotConfig({
      ASKLOYAL_TGBOT_KEY: "fallback-token",
      TELEGRAM_USERBOT_API_HASH: "hash",
      TELEGRAM_USERBOT_API_ID: "123",
    });

    expect(config.authMode).toBe("bot");
    expect(config.botToken).toBe("fallback-token");
  });
});
