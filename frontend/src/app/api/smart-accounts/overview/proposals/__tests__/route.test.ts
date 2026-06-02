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

const fetchCurrentSmartAccountProposalSnapshots = mock(async () => []);
const fetchCurrentSmartAccountOverviewBase = mock(async () => ({}));
const fetchCurrentSmartAccountVaultSnapshots = mock(async () => []);
const fetchCurrentSmartAccountPolicyOverview = mock(async () => ({
  policies: [],
  signers: [],
  spendingLimits: [],
}));

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

describe("smart-account overview proposals route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    fetchCurrentSmartAccountProposalSnapshots.mockClear();
    fetchCurrentSmartAccountProposalSnapshots.mockImplementation(
      async () => []
    );
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/overview/proposals"
      )
    );

    expect(response.status).toBe(401);
    expect(fetchCurrentSmartAccountProposalSnapshots).not.toHaveBeenCalled();
  });

  test("returns timing metadata for successful responses", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/overview/proposals"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      meta: {
        timingsMs: {
          total: expect.any(Number),
        },
      },
    });
  });

  test("returns 429 when the RPC provider rate-limits proposal loading", async () => {
    const error = new Error("rate limited");
    error.name = "SmartAccountOverviewRateLimitError";
    Object.assign(error, { retryAfterSeconds: 15 });
    fetchCurrentSmartAccountProposalSnapshots.mockImplementationOnce(
      async () => {
        throw error;
      }
    );

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/overview/proposals"
      )
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
  });
});
