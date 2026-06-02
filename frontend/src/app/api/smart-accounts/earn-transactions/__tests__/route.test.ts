import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  displayAddress: "wallet-1",
  provider: "solana" as const,
  settingsPda: "settings-1",
  smartAccountAddress: "smart-account-1",
  subjectAddress: "wallet-1",
  walletAddress: "wallet-1",
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

let GET: typeof import("../route").GET;

describe("smart-account earn transactions route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
      displayAddress: "wallet-1",
      provider: "solana" as const,
      settingsPda: "settings-1",
      smartAccountAddress: "smart-account-1",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
    }));
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/earn-transactions"
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "No active auth session.",
      },
    });
  });

  test("returns an empty transaction list", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/earn-transactions"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ transactions: [] });
  });
});
