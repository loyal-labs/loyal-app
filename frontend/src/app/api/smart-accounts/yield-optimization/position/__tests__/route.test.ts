import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const canonicalTargetReserve = "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy";
const canonicalMainnetTargetReserve =
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
const canonicalDevnetMainMarket =
  "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J";
const canonicalDevnetUsdcMint =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  displayAddress: "wallet-1",
  provider: "solana" as const,
  settingsPda: "settings-1",
  smartAccountAddress: "smart-account-1",
  subjectAddress: "wallet-1",
  walletAddress: "wallet-1",
}));

const findActiveYieldPosition = mock(async () => ({
  cluster: "devnet",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  depositMint: canonicalDevnetUsdcMint,
  firstDepositSignature: "deposit-sig-1",
  id: BigInt(1),
  lastConfirmedSlot: BigInt(123),
  lastDepositSignature: "deposit-sig-2",
  liquidityMint: canonicalDevnetUsdcMint,
  market: canonicalDevnetMainMarket,
  policyAccount: "policy-account-1",
  policyId: BigInt(7),
  policySeed: BigInt(1),
  principalAmountRaw: BigInt(1250000),
  settings: "settings-1",
  smartAccountAddress: "smart-account-1",
  status: "active",
  targetReserve: canonicalTargetReserve,
  targetSupplyApyBps: BigInt(846),
  updatedAt: new Date("2026-06-01T00:01:00.000Z"),
  vaultIndex: 1,
  vaultPubkey: "vault-1",
  walletAddress: "wallet-1",
}));

const getCurrentReserveUpdatesByReserve = mock(async () => [
  {
    reserve: canonicalMainnetTargetReserve,
    supplyApy: 0.1048,
  },
]);

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldPosition,
}));

mock.module("@/lib/kamino/timescale-reserve-client.server", () => ({
  getCurrentReserveUpdatesByReserve,
}));

let GET: typeof import("../route").GET;

describe("smart-account active yield position route", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "devnet";
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    findActiveYieldPosition.mockClear();
    getCurrentReserveUpdatesByReserve.mockClear();
    getCurrentReserveUpdatesByReserve.mockImplementation(async () => [
      {
        reserve: canonicalMainnetTargetReserve,
        supplyApy: 0.1048,
      },
    ]);
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
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/position"
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "No active auth session.",
      },
    });
    expect(findActiveYieldPosition).not.toHaveBeenCalled();
    expect(getCurrentReserveUpdatesByReserve).not.toHaveBeenCalled();
  });

  test("loads the active devnet earn position with current Timescale APY", async () => {
    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/position"
      )
    );

    expect(response.status).toBe(200);
    expect(findActiveYieldPosition).toHaveBeenCalledWith({
      cluster: "devnet",
      settings: "settings-1",
      targetReserve: canonicalTargetReserve,
      vaultIndex: 1,
      walletAddress: "wallet-1",
    });
    expect(getCurrentReserveUpdatesByReserve).toHaveBeenCalledWith({
      reserves: [canonicalMainnetTargetReserve],
    });
    await expect(response.json()).resolves.toEqual({
      position: {
        cluster: "devnet",
        createdAt: "2026-06-01T00:00:00.000Z",
        currentSupplyApyBps: "1048",
        depositMint: canonicalDevnetUsdcMint,
        display: {
          label: "Main Market · USDC",
          marketName: "Main Market",
          mintSymbol: "USDC",
        },
        firstDepositSignature: "deposit-sig-1",
        id: "1",
        lastConfirmedSlot: "123",
        lastDepositSignature: "deposit-sig-2",
        liquidityMint: canonicalDevnetUsdcMint,
        market: canonicalDevnetMainMarket,
        policyAccount: "policy-account-1",
        policyId: "7",
        policySeed: "1",
        principalAmountRaw: "1250000",
        settings: "settings-1",
        smartAccountAddress: "smart-account-1",
        status: "active",
        targetReserve: canonicalTargetReserve,
        targetSupplyApyBps: "846",
        updatedAt: "2026-06-01T00:01:00.000Z",
        vaultIndex: 1,
        vaultPubkey: "vault-1",
        walletAddress: "wallet-1",
      },
    });
  });

  test("maps configured mainnet to mainnet-beta cluster", async () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "mainnet";

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/position"
      )
    );

    expect(response.status).toBe(200);
    expect(findActiveYieldPosition).toHaveBeenCalledWith({
      cluster: "mainnet-beta",
      settings: "settings-1",
      targetReserve: canonicalMainnetTargetReserve,
      vaultIndex: 1,
      walletAddress: "wallet-1",
    });
  });

  test("keeps the position when Timescale APY is unavailable", async () => {
    getCurrentReserveUpdatesByReserve.mockImplementationOnce(async () => []);

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/position"
      )
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.position.currentSupplyApyBps).toBeNull();
    expect(payload.position.targetSupplyApyBps).toBe("846");
  });

  test("returns null when no active earn position exists", async () => {
    findActiveYieldPosition.mockImplementationOnce(async () => null as never);

    const response = await GET(
      new Request(
        "https://app.askloyal.com/api/smart-accounts/yield-optimization/position"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ position: null });
    expect(getCurrentReserveUpdatesByReserve).not.toHaveBeenCalled();
  });
});
