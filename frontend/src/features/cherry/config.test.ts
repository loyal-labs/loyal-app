import { describe, expect, test } from "bun:test";

import { createCherryMiniAppConfig } from "./config";

describe("createCherryMiniAppConfig", () => {
  test("stays disabled until Cherry provisioning values exist", () => {
    expect(createCherryMiniAppConfig({})).toEqual({
      mode: "disabled",
      reason: "CHERRY_MINIAPP_ID and CHERRY_MINIAPP_ORIGIN are required",
    });
  });

  test("normalizes the registered app origin and keeps the JWKS path", () => {
    expect(
      createCherryMiniAppConfig({
        CHERRY_MINIAPP_ID: "miniapp_123",
        CHERRY_MINIAPP_ORIGIN: "https://askloyal.com/app/cherry",
      })
    ).toEqual({
      mode: "enabled",
      appId: "miniapp_123",
      expectedOrigin: "https://askloyal.com",
      issuer: "https://chat.cherry.fun",
      jwksUrl: "https://chat.cherry.fun/.well-known/jwks.json",
    });
  });

  test("rejects a non-HTTPS production origin", () => {
    expect(() =>
      createCherryMiniAppConfig({
        CHERRY_MINIAPP_ID: "miniapp_123",
        CHERRY_MINIAPP_ORIGIN: "http://askloyal.com",
      })
    ).toThrow("CHERRY_MINIAPP_ORIGIN must use HTTPS");
  });

  test("allows explicit HTTP localhost fixtures only", () => {
    expect(
      createCherryMiniAppConfig({
        CHERRY_MINIAPP_ID: " miniapp_local ",
        CHERRY_MINIAPP_ORIGIN: "http://127.0.0.1:3000/app/cherry",
        CHERRY_MINIAPP_JWKS_URL: "http://localhost:3100/jwks.json?fixture=1",
      })
    ).toMatchObject({
      mode: "enabled",
      appId: "miniapp_local",
      expectedOrigin: "http://127.0.0.1:3000",
      jwksUrl: "http://localhost:3100/jwks.json?fixture=1",
    });
  });

  test("rejects URL credentials and JWKS fragments", () => {
    expect(() =>
      createCherryMiniAppConfig({
        CHERRY_MINIAPP_ID: "miniapp_123",
        CHERRY_MINIAPP_ORIGIN: "https://user@askloyal.com",
      })
    ).toThrow("CHERRY_MINIAPP_ORIGIN must not contain URL credentials");

    expect(() =>
      createCherryMiniAppConfig({
        CHERRY_MINIAPP_ID: "miniapp_123",
        CHERRY_MINIAPP_ORIGIN: "https://askloyal.com",
        CHERRY_MINIAPP_JWKS_URL:
          "https://chat.cherry.fun/.well-known/jwks.json#ignored",
      })
    ).toThrow("CHERRY_MINIAPP_JWKS_URL must not contain a URL fragment");
  });
});
