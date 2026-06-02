import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: "settings-1",
  smartAccountAddress: "smart-account-1",
  subjectAddress: "wallet-1",
  walletAddress: "wallet-1",
}));

const recordConfirmedYieldDeposit = mock(async () => ({
  cluster: "devnet",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  depositMint: "USDC-mint",
  firstDepositSignature: "deposit-sig-1",
  id: BigInt(1),
  lastConfirmedSlot: BigInt(123),
  lastDepositSignature: "deposit-sig-1",
  liquidityMint: "USDC-mint",
  market: "Main",
  policyAccount: "policy-account-1",
  policyId: BigInt(42),
  policySeed: BigInt(7),
  principalAmountRaw: BigInt(1_000_000),
  settings: "settings-1",
  smartAccountAddress: "smart-account-1",
  status: "active" as const,
  targetReserve: "reserve-1",
  targetSupplyApyBps: BigInt(523),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  vaultIndex: 0,
  vaultPubkey: "vault-1",
  walletAddress: "wallet-1",
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  recordConfirmedYieldDeposit,
}));

let POST: typeof import("../route").POST;

function body(overrides = {}) {
  return {
    cluster: "devnet",
    confirmedSlot: "123",
    depositMint: "USDC-mint",
    depositSignature: "deposit-sig-1",
    liquidityMint: "USDC-mint",
    market: "Main",
    policyAccount: "policy-account-1",
    policyId: "42",
    policySeed: "7",
    policySignature: "policy-sig-1",
    principalAmountRaw: "1000000",
    settings: "settings-1",
    smartAccountAddress: "smart-account-1",
    targetReserve: "reserve-1",
    targetSupplyApyBps: "523",
    vaultIndex: 0,
    vaultPubkey: "vault-1",
    walletAddress: "wallet-1",
    ...overrides,
  };
}

function request(payload = body()) {
  return new Request(
    "https://app.askloyal.com/api/smart-accounts/yield-optimization/deposits/confirm",
    {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}

describe("yield optimization deposit confirm route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  beforeEach(() => {
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    recordConfirmedYieldDeposit.mockClear();
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
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

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(recordConfirmedYieldDeposit).not.toHaveBeenCalled();
  });

  test("returns 403 when request account refs do not match the principal", async () => {
    const response = await POST(request(body({ settings: "settings-2" })));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "principal_mismatch",
        message:
          "Confirmed yield deposit does not match the authenticated wallet session.",
      },
    });
    expect(recordConfirmedYieldDeposit).not.toHaveBeenCalled();
  });

  test("valid confirmed deposit calls the repository with normalized input", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldDeposit).toHaveBeenCalledWith({
      cluster: "devnet",
      confirmedSlot: BigInt(123),
      depositMint: "USDC-mint",
      depositSignature: "deposit-sig-1",
      liquidityMint: "USDC-mint",
      market: "Main",
      policyAccount: "policy-account-1",
      policyId: BigInt(42),
      policySeed: BigInt(7),
      policySignature: "policy-sig-1",
      principalAmountRaw: BigInt(1_000_000),
      settings: "settings-1",
      smartAccountAddress: "smart-account-1",
      targetReserve: "reserve-1",
      targetSupplyApyBps: BigInt(523),
      vaultIndex: 0,
      vaultPubkey: "vault-1",
      walletAddress: "wallet-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      position: {
        id: "1",
        lastConfirmedSlot: "123",
        policyId: "42",
        policySeed: "7",
        principalAmountRaw: "1000000",
        targetSupplyApyBps: "523",
      },
    });
  });
});
