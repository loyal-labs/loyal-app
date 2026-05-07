import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const baseClaims = {
  authMethod: "wallet" as const,
  subjectAddress: "wallet-1",
  displayAddress: "wallet-1",
  walletAddress: "wallet-1",
  provider: "solana" as const,
  smartAccountAddress: "smart-account-1",
  settingsPda: "settings-1",
  iat: 1_700_000_000,
  exp: 1_700_604_800,
};

const refreshedClaims = {
  ...baseClaims,
  iat: 1_700_086_400,
  exp: 1_700_691_200,
};

const readSessionClaimsFromRequest = mock(async (request: Request) => {
  const cookie = request.headers.get("cookie") ?? "";
  if (cookie.includes("refreshed-session-token")) {
    return refreshedClaims;
  }

  return baseClaims;
});
const getSessionMetadata = mock((claims: { iat: number; exp: number }) => ({
  expiresAt: new Date(claims.exp * 1000).toISOString(),
  refreshAfter: new Date(claims.iat * 1000).toISOString(),
}));
const shouldRefreshSessionToken = mock(() => false);
const issueSessionToken = mock(async () => "refreshed-session-token");
const createSessionCookieOptions = mock(() => ({
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: true,
  path: "/" as const,
  maxAge: 604800,
}));

mock.module("@/features/identity/server/session-cookie", () => ({
  WALLET_AUTH_SESSION_COOKIE_NAME: "loyal_wallet_session",
  createAuthSessionCookieService: () => ({
    readSessionClaimsFromRequest,
    getSessionMetadata,
    shouldRefreshSessionToken,
    issueSessionToken,
    createSessionCookieOptions,
  }),
}));

let POST: typeof import("../route").POST;

describe("auth session refresh route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  beforeEach(() => {
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    readSessionClaimsFromRequest.mockClear();
    getSessionMetadata.mockClear();
    shouldRefreshSessionToken.mockClear();
    issueSessionToken.mockClear();
    createSessionCookieOptions.mockClear();
    shouldRefreshSessionToken.mockReturnValue(false);
  });

  test("returns the current wallet session without rewriting a fresh cookie", async () => {
    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/session/refresh", {
        method: "POST",
        headers: {
          cookie: "loyal_wallet_session=session-token",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(issueSessionToken).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      user: {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        walletAddress: "wallet-1",
        provider: "solana",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      },
      session: {
        expiresAt: new Date(baseClaims.exp * 1000).toISOString(),
        refreshAfter: new Date(baseClaims.iat * 1000).toISOString(),
      },
    });
  });

  test("rewrites wallet cookies that are at least 24 hours old", async () => {
    shouldRefreshSessionToken.mockReturnValue(true);

    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/session/refresh", {
        method: "POST",
        headers: {
          cookie: "loyal_wallet_session=session-token",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(issueSessionToken).toHaveBeenCalled();
    expect(createSessionCookieOptions).toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "loyal_wallet_session=refreshed-session-token"
    );
    await expect(response.json()).resolves.toEqual({
      user: {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        walletAddress: "wallet-1",
        provider: "solana",
        smartAccountAddress: "smart-account-1",
        settingsPda: "settings-1",
      },
      session: {
        expiresAt: new Date(refreshedClaims.exp * 1000).toISOString(),
        refreshAfter: new Date(refreshedClaims.iat * 1000).toISOString(),
      },
    });
  });

  test("returns 401 when the session cookie is missing or invalid", async () => {
    readSessionClaimsFromRequest.mockImplementationOnce(async () => null);

    const response = await POST(
      new Request("https://app.askloyal.com/api/auth/session/refresh", {
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "No active auth session.",
      },
    });
  });
});
