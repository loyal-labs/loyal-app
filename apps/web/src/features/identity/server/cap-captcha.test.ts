import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { verifyCaptchaToken } = await import("./cap-captcha");

describe("Cap captcha verification mode", () => {
  const localBypassEnv = {
    ALLOW_LOCAL_CAPTCHA_BYPASS: "1",
    CAP_SECRET: "configured",
    NEXT_PUBLIC_APP_ENVIRONMENT: "local",
    NODE_ENV: "development",
  };

  test("allows an explicitly configured loopback development request", async () => {
    await expect(
      verifyCaptchaToken(
        {
          requestUrl: "http://localhost:3000/api/auth/wallet/challenge",
          token: undefined,
        },
        { env: localBypassEnv }
      )
    ).resolves.toEqual({ ok: true });
  });

  test.each([
    [
      "missing flag",
      { ...localBypassEnv, ALLOW_LOCAL_CAPTCHA_BYPASS: undefined },
      "http://localhost:3000",
    ],
    [
      "production runtime",
      { ...localBypassEnv, NODE_ENV: "production" },
      "http://localhost:3000",
    ],
    [
      "missing runtime",
      { ...localBypassEnv, NODE_ENV: undefined },
      "http://localhost:3000",
    ],
    ["non-loopback request", localBypassEnv, "https://preview.askloyal.com"],
  ])("fails closed for %s", async (_label, env, requestUrl) => {
    await expect(
      verifyCaptchaToken({ requestUrl, token: undefined }, { env })
    ).resolves.toEqual({ ok: false, reason: "missing_captcha_token" });
  });

  test("fails closed outside local when Cap is not configured", async () => {
    await expect(
      verifyCaptchaToken(
        { requestUrl: "https://app.askloyal.com", token: undefined },
        { env: { NEXT_PUBLIC_APP_ENVIRONMENT: "prod" } }
      )
    ).resolves.toEqual({
      ok: false,
      reason: "captcha_verify_unavailable",
    });
  });

  test("requires a token outside local when Cap is configured", async () => {
    await expect(
      verifyCaptchaToken(
        { requestUrl: "https://app.askloyal.com", token: undefined },
        {
          env: {
            CAP_SECRET: "configured",
            NEXT_PUBLIC_APP_ENVIRONMENT: "dev",
          },
        }
      )
    ).resolves.toEqual({ ok: false, reason: "missing_captcha_token" });
  });

  test("rejects malformed and replayed tokens", async () => {
    const env = {
      CAP_SECRET: "configured",
      NEXT_PUBLIC_APP_ENVIRONMENT: "prod",
    };
    await expect(
      verifyCaptchaToken(
        { requestUrl: "https://app.askloyal.com", token: "malformed" },
        { env }
      )
    ).resolves.toEqual({ ok: false, reason: "captcha_verification_failed" });
    await expect(
      verifyCaptchaToken(
        { requestUrl: "https://app.askloyal.com", token: "id:secret" },
        { consumeToken: async () => false, env }
      )
    ).resolves.toEqual({ ok: false, reason: "captcha_verification_failed" });
  });

  test("fails closed when the single-use token store is unavailable", async () => {
    await expect(
      verifyCaptchaToken(
        { requestUrl: "https://app.askloyal.com", token: "id:secret" },
        {
          consumeToken: async () => {
            throw new Error("unavailable");
          },
          env: {
            CAP_SECRET: "configured",
            NEXT_PUBLIC_APP_ENVIRONMENT: "prod",
          },
        }
      )
    ).resolves.toEqual({ ok: false, reason: "captcha_verify_unavailable" });
  });
});
