import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { verifyCaptchaToken } = await import("./cap-captcha");

describe("Cap captcha verification mode", () => {
  test("allows local authentication without a captcha token", async () => {
    await expect(
      verifyCaptchaToken(
        { token: undefined },
        {
          env: {
            CAP_SECRET: "configured",
            NEXT_PUBLIC_APP_ENVIRONMENT: "local",
          },
        }
      )
    ).resolves.toEqual({ ok: true });
  });

  test("fails closed outside local when Cap is not configured", async () => {
    await expect(
      verifyCaptchaToken(
        { token: undefined },
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
        { token: undefined },
        {
          env: {
            CAP_SECRET: "configured",
            NEXT_PUBLIC_APP_ENVIRONMENT: "dev",
          },
        }
      )
    ).resolves.toEqual({ ok: false, reason: "missing_captcha_token" });
  });
});
