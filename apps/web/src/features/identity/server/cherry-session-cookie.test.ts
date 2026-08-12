import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { CHERRY_EMBED_CONTEXT_COOKIE_NAME, CHERRY_WALLET_SESSION_COOKIE_NAME } =
  await import("./cherry-session-cookie");
const {
  createAuthSessionCookieService,
  getSessionCookieName,
  WALLET_AUTH_SESSION_COOKIE_NAME,
} = await import("./session-cookie");

const config = {
  authCookieAllowLocalhost: false,
  authCookieParentDomains: ["askloyal.com"],
  authCookiePreviewFallback: false,
  authJwtSecret: "test-only-secret",
  authJwtTtlSeconds: 604_800,
  authSessionRs256PrivateKey: undefined,
  authSessionRs256PublicKey: undefined,
};

function request(cookie?: string): Request {
  return new Request("https://askloyal.com/api/auth/session", {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("Cherry partitioned wallet session", () => {
  test("selects the isolated session only with the exact verified-context marker", () => {
    expect(getSessionCookieName(request())).toBe(
      WALLET_AUTH_SESSION_COOKIE_NAME
    );
    expect(
      getSessionCookieName(request(`${CHERRY_EMBED_CONTEXT_COOKIE_NAME}=0`))
    ).toBe(WALLET_AUTH_SESSION_COOKIE_NAME);
    expect(
      getSessionCookieName(request(`${CHERRY_EMBED_CONTEXT_COOKIE_NAME}=1`))
    ).toBe(CHERRY_WALLET_SESSION_COOKIE_NAME);
  });

  test("keeps normal cookies Lax and makes iframe cookies host-only partitioned", () => {
    const service = createAuthSessionCookieService({ getConfig: () => config });

    expect(service.createSessionCookieOptions(request())).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: config.authJwtTtlSeconds,
      domain: "askloyal.com",
    });
    expect(
      service.createSessionCookieOptions(
        request(`${CHERRY_EMBED_CONTEXT_COOKIE_NAME}=1`)
      )
    ).toEqual({
      httpOnly: true,
      sameSite: "none",
      secure: true,
      partitioned: true,
      path: "/",
      maxAge: config.authJwtTtlSeconds,
    });
    expect(
      service.createClearedSessionCookieOptions(
        request(`${CHERRY_EMBED_CONTEXT_COOKIE_NAME}=1`)
      )
    ).toMatchObject({ maxAge: 0, partitioned: true, sameSite: "none" });
  });
});
