import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let createAuthSessionCookieService: typeof import("../session-cookie").createAuthSessionCookieService;
let SESSION_REFRESH_MIN_AGE_MS: typeof import("../session-cookie").SESSION_REFRESH_MIN_AGE_MS;

const config = {
  authCookieAllowLocalhost: true,
  authCookieParentDomain: "askloyal.com",
  authJwtSecret: "jwt-secret-jwt-secret-jwt-secret-123",
  authJwtTtlSeconds: 60 * 60 * 24 * 7,
  authSessionRs256PrivateKey: undefined,
  authSessionRs256PublicKey: undefined,
};

describe("frontend session cookie service", () => {
  beforeAll(async () => {
    ({ createAuthSessionCookieService, SESSION_REFRESH_MIN_AGE_MS } =
      await import("../session-cookie"));
  });

  test("reads verified wallet session claims including iat/exp", async () => {
    const service = createAuthSessionCookieService({
      getConfig: () => config,
    });
    const token = await service.issueSessionToken({
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      displayAddress: "wallet-1",
      walletAddress: "wallet-1",
      provider: "solana",
      smartAccountAddress: "smart-account-1",
      settingsPda: "settings-1",
    });

    const claims = await service.readSessionClaimsFromRequest(
      new Request("https://app.askloyal.com/api/auth/session", {
        headers: {
          cookie: `loyal_wallet_session=${token}`,
        },
      })
    );

    expect(claims).toMatchObject({
      authMethod: "wallet",
      walletAddress: "wallet-1",
      smartAccountAddress: "smart-account-1",
      settingsPda: "settings-1",
    });
    expect(typeof claims?.iat).toBe("number");
    expect(typeof claims?.exp).toBe("number");
  });

  test("derives wallet session metadata from iat and exp", () => {
    const service = createAuthSessionCookieService({
      getConfig: () => config,
    });

    expect(
      service.getSessionMetadata({
        iat: 1_700_000_000,
        exp: 1_700_604_800,
      })
    ).toEqual({
      expiresAt: "2023-11-21T22:13:20.000Z",
      refreshAfter: "2023-11-15T22:13:20.000Z",
    });
  });

  test("does not refresh wallet tokens younger than 24 hours", () => {
    const service = createAuthSessionCookieService({
      getConfig: () => config,
    });

    expect(
      service.shouldRefreshSessionToken(
        {
          authMethod: "wallet",
          iat: Math.floor((Date.now() - SESSION_REFRESH_MIN_AGE_MS + 1000) / 1000),
        },
        new Date()
      )
    ).toBe(false);
  });

  test("refreshes wallet tokens that are at least 24 hours old", () => {
    const service = createAuthSessionCookieService({
      getConfig: () => config,
    });
    const now = new Date("2026-04-08T12:00:00.000Z");

    expect(
      service.shouldRefreshSessionToken(
        {
          authMethod: "wallet",
          iat: Math.floor(
            (now.getTime() - SESSION_REFRESH_MIN_AGE_MS) / 1000
          ),
        },
        now
      )
    ).toBe(true);
  });

  test("never auto-refreshes non-wallet sessions", () => {
    const service = createAuthSessionCookieService({
      getConfig: () => config,
    });
    const now = new Date("2026-04-08T12:00:00.000Z");

    expect(
      service.shouldRefreshSessionToken(
        {
          authMethod: "email",
          iat: Math.floor(
            (now.getTime() - SESSION_REFRESH_MIN_AGE_MS * 2) / 1000
          ),
        },
        now
      )
    ).toBe(false);
  });
});
