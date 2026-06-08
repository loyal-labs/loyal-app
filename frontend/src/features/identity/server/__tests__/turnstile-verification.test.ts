import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { verifyTurnstileToken } = await import("../turnstile-verification");

const PROD_ENV = {
  NEXT_PUBLIC_APP_ENVIRONMENT: "prod",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
  TURNSTILE_SECRET_KEY: "secret-key",
};

function siteverifyOk(success: boolean): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ success }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("verifyTurnstileToken", () => {
  test("local mode requires the bypass token", async () => {
    const env = { NEXT_PUBLIC_APP_ENVIRONMENT: "local" };

    await expect(
      verifyTurnstileToken({ token: "local-bypass" }, { env })
    ).resolves.toEqual({ ok: true });
    await expect(
      verifyTurnstileToken({ token: undefined }, { env })
    ).resolves.toMatchObject({ ok: false });
    await expect(
      verifyTurnstileToken({ token: "anything-else" }, { env })
    ).resolves.toMatchObject({ ok: false });
  });

  test("skips verification when no site key is configured (non-local)", async () => {
    await expect(
      verifyTurnstileToken(
        { token: undefined },
        { env: { NEXT_PUBLIC_APP_ENVIRONMENT: "prod" } }
      )
    ).resolves.toEqual({ ok: true });
  });

  test("fails closed when site key is set but secret is missing", async () => {
    await expect(
      verifyTurnstileToken(
        { token: "tok" },
        {
          env: {
            NEXT_PUBLIC_APP_ENVIRONMENT: "prod",
            NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
          },
        }
      )
    ).resolves.toMatchObject({ ok: false, reason: "turnstile_secret_missing" });
  });

  test("rejects a missing token in enforce mode", async () => {
    await expect(
      verifyTurnstileToken(
        { token: undefined },
        { env: PROD_ENV, fetchImpl: siteverifyOk(true) }
      )
    ).resolves.toMatchObject({ ok: false, reason: "missing_turnstile_token" });
  });

  test("accepts a token Cloudflare confirms", async () => {
    let captured: { url: unknown; body: unknown } | null = null;
    const fetchImpl = (async (url: unknown, init: RequestInit) => {
      captured = { url, body: init.body };
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await expect(
      verifyTurnstileToken(
        { token: "real-token", remoteIp: "1.2.3.4" },
        { env: PROD_ENV, fetchImpl }
      )
    ).resolves.toEqual({ ok: true });

    expect(String(captured!.url)).toContain("siteverify");
    expect(String(captured!.body)).toContain("response=real-token");
    expect(String(captured!.body)).toContain("secret=secret-key");
    expect(String(captured!.body)).toContain("remoteip=1.2.3.4");
  });

  test("rejects a token Cloudflare denies", async () => {
    await expect(
      verifyTurnstileToken(
        { token: "bad-token" },
        { env: PROD_ENV, fetchImpl: siteverifyOk(false) }
      )
    ).resolves.toMatchObject({
      ok: false,
      reason: "turnstile_verification_failed",
    });
  });

  test("fails closed when the verifier is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      verifyTurnstileToken({ token: "tok" }, { env: PROD_ENV, fetchImpl })
    ).resolves.toMatchObject({
      ok: false,
      reason: "turnstile_verify_unavailable",
    });
  });
});
