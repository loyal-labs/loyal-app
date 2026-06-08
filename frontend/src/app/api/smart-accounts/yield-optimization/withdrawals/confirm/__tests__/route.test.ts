import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
} from "@loyal/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  createYieldDepositRepositoryMock,
  recordConfirmedYieldWithdrawal,
} from "@/test/yield-route-mocks";

mock.module("server-only", () => ({}));

const settings = new PublicKey("11111111111111111111111111111112");
const walletAddress = new PublicKey("11111111111111111111111111111113");
const smartAccountAddress = new PublicKey("11111111111111111111111111111114");
const earnTarget = getKaminoUsdcEarnTargetForCluster(LoyalCluster.Devnet);
const vaultPubkey = pda.getSmartAccountPda({
  settingsPda: settings,
  accountIndex: 1,
})[0];
const policyAccountForSeed = (policySeed: number) =>
  pda
    .getPolicyPda({
      settingsPda: settings,
      policySeed,
    })[0]
    .toBase58();
const getSignatureStatuses = mock(async () => ({
  value: [
    {
      confirmationStatus: "confirmed" as const,
      err: null,
      slot: 123,
    },
  ],
}));

(
  Connection.prototype as unknown as {
    getSignatureStatuses: typeof getSignatureStatuses;
  }
).getSignatureStatuses = getSignatureStatuses;

const resolveAuthenticatedPrincipalFromRequest = mock(async () => ({
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: settings.toBase58(),
  smartAccountAddress: smartAccountAddress.toBase58(),
  subjectAddress: walletAddress.toBase58(),
  walletAddress: walletAddress.toBase58(),
}));

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest,
}));

mock.module(
  "@/lib/yield-optimization/yield-deposit-repository.server",
  createYieldDepositRepositoryMock
);

mock.module("@/lib/solana/rpc-endpoints", () => ({
  getFrontendSolanaEndpoints: () => ({
    rpcEndpoint: "https://rpc.example",
    websocketEndpoint: "wss://rpc.example",
  }),
}));

mock.module("@/lib/solana/rpc-rate-limit", () => ({
  getFrontendSolanaRpcFetch: (fetch: typeof globalThis.fetch) => fetch,
}));

let POST: typeof import("../route").POST;
const previousSolanaEnv = process.env.NEXT_PUBLIC_SOLANA_ENV;

function body(overrides = {}) {
  const usdcMint = earnTarget.liquidityMint.toBase58();
  const policySeed = "2";
  return {
    cluster: "devnet",
    confirmedSlot: "123",
    liquidityMint: usdcMint,
    market: earnTarget.market.toBase58(),
    mode: "partial",
    policyAccount: policyAccountForSeed(Number(policySeed)),
    policyId: policySeed,
    policySeed,
    settings: settings.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    targetReserve: earnTarget.reserve.toBase58(),
    vaultIndex: 1,
    vaultPubkey: vaultPubkey.toBase58(),
    walletAddress: walletAddress.toBase58(),
    withdrawalSignature: "withdrawal-sig-1",
    withdrawnAmountRaw: "250000",
    ...overrides,
  };
}

function request(payload = body()) {
  return new Request(
    "https://app.askloyal.com/api/smart-accounts/yield-optimization/withdrawals/confirm",
    {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}

describe("yield optimization withdrawal confirm route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  afterAll(() => {
    if (previousSolanaEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SOLANA_ENV;
    } else {
      process.env.NEXT_PUBLIC_SOLANA_ENV = previousSolanaEnv;
    }
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "devnet";
    resolveAuthenticatedPrincipalFromRequest.mockClear();
    recordConfirmedYieldWithdrawal.mockClear();
    getSignatureStatuses.mockClear();
    getSignatureStatuses.mockImplementation(async () => ({
      value: [
        {
          confirmationStatus: "confirmed" as const,
          err: null,
          slot: 123,
        },
      ],
    }));
    resolveAuthenticatedPrincipalFromRequest.mockImplementation(async () => ({
      authMethod: "wallet" as const,
      provider: "solana" as const,
      settingsPda: settings.toBase58(),
      smartAccountAddress: smartAccountAddress.toBase58(),
      subjectAddress: walletAddress.toBase58(),
      walletAddress: walletAddress.toBase58(),
    }));
    recordConfirmedYieldWithdrawal.mockImplementation(async () => ({
      cluster: "devnet",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      firstDepositSignature: "deposit-sig-1",
      currentAmountRaw: BigInt(750_000),
      currentLiquidityMint: earnTarget.liquidityMint.toBase58(),
      currentMarket: earnTarget.market.toBase58(),
      currentObservedAt: new Date("2026-06-01T00:00:00.000Z"),
      currentObservedSlot: BigInt(123),
      currentReserve: earnTarget.reserve.toBase58(),
      id: BigInt(1),
      initialLiquidityMint: earnTarget.liquidityMint.toBase58(),
      initialMarket: earnTarget.market.toBase58(),
      initialReserve: earnTarget.reserve.toBase58(),
      initialSupplyApyBps: BigInt(523),
      lastConfirmedSlot: BigInt(123),
      lastDepositSignature: "deposit-sig-1",
      lastHoldingEventId: BigInt(100),
      lastRebalanceDecisionId: null,
      policyAccount: policyAccountForSeed(2),
      policyId: BigInt(2),
      policySeed: BigInt(2),
      principalAmountRaw: BigInt(750_000),
      settings: settings.toBase58(),
      smartAccountAddress: smartAccountAddress.toBase58(),
      status: "active" as const,
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: walletAddress.toBase58(),
    }));
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });

  test("returns 403 when request account refs do not match the principal", async () => {
    const response = await POST(
      request(body({ settings: "11111111111111111111111111111115" }))
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "principal_mismatch",
        message:
          "Confirmed yield withdrawal does not match the authenticated wallet session.",
      },
    });
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });

  test("valid confirmed withdrawal calls the repository with normalized input", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldWithdrawal).toHaveBeenCalledWith({
      cluster: "devnet",
      confirmedSlot: BigInt(123),
      liquidityMint: earnTarget.liquidityMint.toBase58(),
      market: earnTarget.market.toBase58(),
      mode: "partial",
      policyAccount: policyAccountForSeed(2),
      policyId: BigInt(2),
      policySeed: BigInt(2),
      settings: settings.toBase58(),
      smartAccountAddress: smartAccountAddress.toBase58(),
      targetReserve: earnTarget.reserve.toBase58(),
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: walletAddress.toBase58(),
      withdrawalSignature: "withdrawal-sig-1",
      withdrawnAmountRaw: BigInt(250_000),
    });
    expect(getSignatureStatuses).toHaveBeenCalledWith(["withdrawal-sig-1"], {
      searchTransactionHistory: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      position: {
        currentHolding: {
          amountRaw: "750000",
          provenance: {
            lastHoldingEventId: "100",
            lastRebalanceDecisionId: null,
          },
        },
        id: "1",
        initialHolding: {
          supplyApyBps: "523",
        },
        principalAmountRaw: "750000",
        status: "active",
      },
    });
  });

  test("returns 400 when client policy metadata is tampered", async () => {
    const response = await POST(
      request(body({ policyAccount: policyAccountForSeed(3) }))
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "metadata_mismatch",
        message:
          "policyAccount does not match the canonical earn withdrawal metadata.",
      },
    });
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });

  test("returns 400 when the submitted signature is not confirmed", async () => {
    getSignatureStatuses.mockImplementationOnce(async () => ({
      value: [
        {
          confirmationStatus: "processed" as const,
          err: null,
          slot: 123,
        },
      ],
    }));

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unconfirmed_signature",
      },
    });
    expect(recordConfirmedYieldWithdrawal).not.toHaveBeenCalled();
  });
});
