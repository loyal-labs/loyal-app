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

const fetchCurrentSmartAccountOverviewBase = mock(async () => ({
  accountUtilization: 0,
  canonicalVaultAddress: "vault-1",
  fetchedAt: 1,
  policies: [],
  programId: "program-1",
  proposals: [],
  settingsPda: "settings-1",
  signers: [],
  spendingLimits: [],
  staleTransactionIndex: "0",
  threshold: 1,
  timeLock: 0,
  transactionIndex: "0",
  vaults: [{ accountIndex: 0, address: "vault-1" }],
}));
const fetchCurrentSmartAccountVaultSnapshots = mock(async () => []);
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

describe("smart-account overview base route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    fetchCurrentSmartAccountOverviewBase.mockClear();
    fetchCurrentSmartAccountOverviewBase.mockImplementation(async () => ({
      accountUtilization: 0,
      canonicalVaultAddress: "vault-1",
      fetchedAt: 1,
      policies: [],
      programId: "program-1",
      proposals: [],
      settingsPda: "settings-1",
      signers: [],
      spendingLimits: [],
      staleTransactionIndex: "0",
      threshold: 1,
      timeLock: 0,
      transactionIndex: "0",
      vaults: [{ accountIndex: 0, address: "vault-1" }],
    }));
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request("https://app.askloyal.com/api/smart-accounts/overview/base")
    );

    expect(response.status).toBe(401);
    expect(fetchCurrentSmartAccountOverviewBase).not.toHaveBeenCalled();
  });

  test("returns timing metadata for successful responses", async () => {
    const response = await GET(
      new Request("https://app.askloyal.com/api/smart-accounts/overview/base")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Server-Timing")).toContain(
      "smart-account-overview-base"
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        settingsPda: "settings-1",
        transactionIndex: "0",
        vaults: [{ accountIndex: 0, address: "vault-1" }],
      },
      meta: {
        timingsMs: {
          total: expect.any(Number),
        },
      },
    });
  });

  test("returns 429 when the RPC provider rate-limits base loading", async () => {
    const error = new Error("rate limited");
    error.name = "SmartAccountOverviewRateLimitError";
    Object.assign(error, { retryAfterSeconds: 15 });
    fetchCurrentSmartAccountOverviewBase.mockImplementationOnce(async () => {
      throw error;
    });

    const response = await GET(
      new Request("https://app.askloyal.com/api/smart-accounts/overview/base")
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
  });
});
