import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  subjectAddress: "wallet-1",
  displayAddress: "wallet-1",
  walletAddress: "wallet-1",
  provider: "solana" as const,
  smartAccountAddress: "smart-account-1",
  settingsPda: "settings-1",
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

const fetchCurrentSmartAccountOverview = mock(async () => ({
  approvals: [],
  programId: "program-1",
  settingsPda: "settings-1",
  vaults: [],
}));

mock.module("@/features/smart-accounts/server/read-model", () => ({
  fetchCurrentSmartAccountOverview,
  isSmartAccountOverviewRateLimitError: (error: unknown) =>
    error instanceof Error &&
    error.name === "SmartAccountOverviewRateLimitError",
}));

let GET: typeof import("../route").GET;

describe("smart-account overview route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    fetchCurrentSmartAccountOverview.mockClear();
    fetchCurrentSmartAccountOverview.mockImplementation(async () => ({
      approvals: [],
      programId: "program-1",
      settingsPda: "settings-1",
      vaults: [],
    }));
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null
    );

    const response = await GET(
      new Request("https://app.askloyal.com/api/smart-accounts/overview")
    );

    expect(response.status).toBe(401);
    expect(fetchCurrentSmartAccountOverview).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "No active auth session.",
      },
    });
  });

  test("returns 429 when the RPC provider rate-limits overview loading", async () => {
    const error = new Error("rate limited");
    error.name = "SmartAccountOverviewRateLimitError";
    Object.assign(error, { retryAfterSeconds: 15 });
    fetchCurrentSmartAccountOverview.mockImplementationOnce(async () => {
      throw error;
    });

    const response = await GET(
      new Request("https://app.askloyal.com/api/smart-accounts/overview")
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "rpc_rate_limited",
        message:
          "Smart-account data is temporarily rate limited. Please wait a moment and try again.",
      },
    });
  });
});
