import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const readSessionClaimsFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  subjectAddress: "wallet-1",
  displayAddress: "wallet-1",
  walletAddress: "wallet-1",
  provider: "solana",
  iat: 1_700_000_000,
  exp: 1_700_604_800,
  smartAccountAddress: "smart-account-1",
  settingsPda: "settings-1",
}));
const getSessionMetadata = mock(() => ({
  expiresAt: "2023-11-21T22:13:20.000Z",
  refreshAfter: "2023-11-15T22:13:20.000Z",
}));

mock.module("@/features/identity/server/session-cookie", () => ({
  createAuthSessionCookieService: () => ({
    readSessionClaimsFromRequest,
    getSessionMetadata,
  }),
}));

let GET: typeof import("../route").GET;

describe("auth session route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    readSessionClaimsFromRequest.mockClear();
    getSessionMetadata.mockClear();
  });

  test("returns the authenticated wallet user and session metadata", async () => {
    const response = await GET(
      new Request("https://app.askloyal.com/api/auth/session", {
        headers: {
          cookie: "loyal_wallet_session=session-token",
        },
      })
    );

    expect(response.status).toBe(200);
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
        expiresAt: "2023-11-21T22:13:20.000Z",
        refreshAfter: "2023-11-15T22:13:20.000Z",
      },
    });
  });

  test("returns 401 when the session cookie is missing or invalid", async () => {
    readSessionClaimsFromRequest.mockImplementationOnce(async () => null);

    const response = await GET(
      new Request("https://app.askloyal.com/api/auth/session")
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
