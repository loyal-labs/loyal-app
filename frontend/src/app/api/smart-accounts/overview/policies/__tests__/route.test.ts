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

const fetchCurrentSmartAccountPolicyOverview = mock(async () => ({
  policies: [],
  signers: [],
  spendingLimits: [],
}));
const fetchCurrentSmartAccountOverviewBase = mock(async () => ({}));
const fetchCurrentSmartAccountVaultSnapshots = mock(async () => []);
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

describe("smart-account overview policies route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    fetchCurrentSmartAccountPolicyOverview.mockClear();
    fetchCurrentSmartAccountPolicyOverview.mockImplementation(async () => ({
      policies: [],
      signers: [],
      spendingLimits: [],
    }));
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/overview/policies"
      )
    );

    expect(response.status).toBe(401);
    expect(fetchCurrentSmartAccountPolicyOverview).not.toHaveBeenCalled();
  });

  test("returns timing metadata for successful responses", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/overview/policies"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        policies: [],
        spendingLimits: [],
      },
      meta: {
        timingsMs: {
          total: expect.any(Number),
        },
      },
    });
  });

  test("returns 429 when the RPC provider rate-limits policy loading", async () => {
    const error = new Error("rate limited");
    error.name = "SmartAccountOverviewRateLimitError";
    Object.assign(error, { retryAfterSeconds: 15 });
    fetchCurrentSmartAccountPolicyOverview.mockImplementationOnce(async () => {
      throw error;
    });

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/overview/policies"
      )
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
  });
});
