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

const fetchCurrentSmartAccountVaultSnapshots = mock(async () => []);
const fetchCurrentSmartAccountOverviewBase = mock(async () => ({}));
const fetchCurrentSmartAccountPolicyOverview = mock(async () => ({
  policies: [],
  signers: [],
  spendingLimits: [],
}));
const fetchCurrentSmartAccountProposalSnapshots = mock(async () => []);

mock.module("@/features/smart-accounts/server/read-model", () => ({
  fetchCurrentSmartAccountOverviewBase,
  fetchCurrentSmartAccountVaultSnapshots,
  fetchCurrentSmartAccountPolicyOverview,
  fetchCurrentSmartAccountProposalSnapshots,
  isSmartAccountOverviewRateLimitError: (error: unknown) =>
    error instanceof Error &&
    error.name === "SmartAccountOverviewRateLimitError",
}));

let GET: typeof import("../route").GET;

describe("smart-account overview vaults route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    fetchCurrentSmartAccountVaultSnapshots.mockClear();
    fetchCurrentSmartAccountVaultSnapshots.mockImplementation(async () => []);
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request("https://app.askloyal.com/api/smart-accounts/overview/vaults")
    );

    expect(response.status).toBe(401);
    expect(fetchCurrentSmartAccountVaultSnapshots).not.toHaveBeenCalled();
  });

  test("passes account utilization and invalidate query params", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/overview/vaults?accountUtilization=2&invalidate=a,b"
      )
    );

    expect(response.status).toBe(200);
    expect(fetchCurrentSmartAccountVaultSnapshots).toHaveBeenCalledWith({
      accountUtilization: 2,
      invalidateAddresses: ["a", "b"],
      settingsPda: "settings-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      meta: {
        timingsMs: {
          total: expect.any(Number),
        },
      },
    });
  });

  test("returns 429 when the RPC provider rate-limits vault loading", async () => {
    const error = new Error("rate limited");
    error.name = "SmartAccountOverviewRateLimitError";
    Object.assign(error, { retryAfterSeconds: 15 });
    fetchCurrentSmartAccountVaultSnapshots.mockImplementationOnce(async () => {
      throw error;
    });

    const response = await GET(
      new Request("https://app.askloyal.com/api/smart-accounts/overview/vaults")
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
  });
});
