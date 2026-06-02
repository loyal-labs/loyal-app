import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const canonicalTargetReserve = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";

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
  depositMint: "deposit-mint-1",
  firstDepositSignature: "deposit-sig-1",
  id: BigInt(1),
  lastConfirmedSlot: BigInt(123),
  lastDepositSignature: "deposit-sig-2",
  liquidityMint: "liquidity-mint-1",
  market: "market-1",
  policyAccount: "policy-account-1",
  policyId: BigInt(7),
  policySeed: BigInt(1),
  principalAmountRaw: BigInt(1250000),
  settings: "settings-1",
  smartAccountAddress: "smart-account-1",
  status: "active",
  targetReserve: "reserve-1",
  targetSupplyApyBps: BigInt(846),
  updatedAt: new Date("2026-06-01T00:01:00.000Z"),
  vaultIndex: 1,
  vaultPubkey: "vault-1",
  walletAddress: "wallet-1",
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldPosition,
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
  });

  test("loads the active devnet earn position for the authenticated wallet", async () => {
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
    await expect(response.json()).resolves.toEqual({
      position: {
        cluster: "devnet",
        createdAt: "2026-06-01T00:00:00.000Z",
        depositMint: "deposit-mint-1",
        firstDepositSignature: "deposit-sig-1",
        id: "1",
        lastConfirmedSlot: "123",
        lastDepositSignature: "deposit-sig-2",
        liquidityMint: "liquidity-mint-1",
        market: "market-1",
        policyAccount: "policy-account-1",
        policyId: "7",
        policySeed: "1",
        principalAmountRaw: "1250000",
        settings: "settings-1",
        smartAccountAddress: "smart-account-1",
        status: "active",
        targetReserve: "reserve-1",
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
      targetReserve: canonicalTargetReserve,
      vaultIndex: 1,
      walletAddress: "wallet-1",
    });
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
  });
});
