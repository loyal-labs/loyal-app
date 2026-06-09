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
import type { SmartAccountPreparedEarnUsdcDeposit } from "@loyal-labs/smart-account-vaults";
import { PublicKey, Connection } from "@solana/web3.js";

import { buildEarnDepositConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  createYieldDepositRepositoryMock,
  recordConfirmedYieldDeposit,
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
    depositMint: usdcMint,
    depositSignature: "deposit-sig-1",
    liquidityMint: usdcMint,
    market: earnTarget.market.toBase58(),
    policyAccount: policyAccountForSeed(Number(policySeed)),
    policyId: policySeed,
    policyInitialization: "reuse",
    policySeed,
    policySignature: "deposit-sig-1",
    principalAmountRaw: "1000000",
    settings: settings.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    targetReserve: earnTarget.reserve.toBase58(),
    targetSupplyApyBps: null,
    vaultIndex: 1,
    vaultPubkey: vaultPubkey.toBase58(),
    walletAddress: walletAddress.toBase58(),
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

function preparedDepositFromBody(
  payload = body()
): SmartAccountPreparedEarnUsdcDeposit {
  return {
    persistence: {
      cluster: payload.cluster,
      depositMint: payload.depositMint,
      liquidityMint: payload.liquidityMint,
      market: payload.market,
      policyAccount: payload.policyAccount,
      policyId: payload.policyId,
      policyInitialization: payload.policyInitialization,
      policySeed: payload.policySeed,
      principalAmountRaw: payload.principalAmountRaw,
      settings: payload.settings,
      targetReserve: payload.targetReserve,
      targetSupplyApyBps: payload.targetSupplyApyBps,
      vaultIndex: payload.vaultIndex,
      vaultPubkey: payload.vaultPubkey,
      walletAddress: payload.walletAddress,
    },
  } as SmartAccountPreparedEarnUsdcDeposit;
}

describe("yield optimization deposit confirm route", () => {
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
    recordConfirmedYieldDeposit.mockClear();
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
    recordConfirmedYieldDeposit.mockImplementation(async () => ({
      cluster: "devnet",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      firstDepositSignature: "deposit-sig-1",
      currentAmountRaw: BigInt(1_000_000),
      currentLiquidityMint: "USDC-mint",
      currentMarket: "Main",
      currentObservedAt: new Date("2026-06-01T00:00:00.000Z"),
      currentObservedSlot: BigInt(123),
      currentReserve: earnTarget.reserve.toBase58(),
      id: BigInt(1),
      initialLiquidityMint: "USDC-mint",
      initialMarket: "Main",
      initialReserve: earnTarget.reserve.toBase58(),
      initialSupplyApyBps: null,
      lastConfirmedSlot: BigInt(123),
      lastDepositSignature: "deposit-sig-1",
      lastHoldingEventId: BigInt(99),
      lastRebalanceDecisionId: null,
      policyAccount: "policy-account-1",
      policyId: BigInt(42),
      policySeed: BigInt(7),
      principalAmountRaw: BigInt(1_000_000),
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
    expect(recordConfirmedYieldDeposit).not.toHaveBeenCalled();
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
      depositMint: earnTarget.liquidityMint.toBase58(),
      depositSignature: "deposit-sig-1",
      liquidityMint: earnTarget.liquidityMint.toBase58(),
      market: earnTarget.market.toBase58(),
      policyAccount: policyAccountForSeed(2),
      policyId: BigInt(2),
      policyInitialization: "reuse",
      policySeed: BigInt(2),
      policySignature: "deposit-sig-1",
      principalAmountRaw: BigInt(1_000_000),
      settings: settings.toBase58(),
      smartAccountAddress: smartAccountAddress.toBase58(),
      targetReserve: earnTarget.reserve.toBase58(),
      targetSupplyApyBps: null,
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
    expect(getSignatureStatuses).toHaveBeenCalledWith(["deposit-sig-1"], {
      searchTransactionHistory: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      position: {
        currentHolding: {
          amountRaw: "1000000",
          provenance: {
            lastHoldingEventId: "99",
            lastRebalanceDecisionId: null,
          },
        },
        id: "1",
        initialHolding: {
          supplyApyBps: null,
        },
        principalAmountRaw: "1000000",
        status: "active",
      },
    });
  });

  test("accepts a deposit body built by the shared confirm contract", async () => {
    const response = await POST(
      request(
        buildEarnDepositConfirmRequestBody({
          confirmedSlot: "123",
          preparedDeposit: preparedDepositFromBody(),
          signature: "deposit-sig-1",
          smartAccountAddress: smartAccountAddress.toBase58(),
        })
      )
    );

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        depositSignature: "deposit-sig-1",
        policySignature: "deposit-sig-1",
      })
    );
  });

  test("accepts mainnet-beta deposit metadata when configured env is mainnet", async () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "mainnet";
    const mainnetTarget = getKaminoUsdcEarnTargetForCluster(
      LoyalCluster.MainnetBeta
    );

    const response = await POST(
      request(
        body({
          cluster: "mainnet-beta",
          depositMint: mainnetTarget.liquidityMint.toBase58(),
          liquidityMint: mainnetTarget.liquidityMint.toBase58(),
          market: mainnetTarget.market.toBase58(),
          targetReserve: mainnetTarget.reserve.toBase58(),
        })
      )
    );

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster: "mainnet-beta",
        depositMint: mainnetTarget.liquidityMint.toBase58(),
        liquidityMint: mainnetTarget.liquidityMint.toBase58(),
        market: mainnetTarget.market.toBase58(),
        targetReserve: mainnetTarget.reserve.toBase58(),
      })
    );
  });

  test("normalizes legacy mainnet deposit metadata before canonical comparison", async () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "mainnet";
    const mainnetTarget = getKaminoUsdcEarnTargetForCluster(
      LoyalCluster.MainnetBeta
    );

    const response = await POST(
      request(
        body({
          cluster: "mainnet",
          depositMint: mainnetTarget.liquidityMint.toBase58(),
          liquidityMint: mainnetTarget.liquidityMint.toBase58(),
          market: mainnetTarget.market.toBase58(),
          targetReserve: mainnetTarget.reserve.toBase58(),
        })
      )
    );

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster: "mainnet-beta",
      })
    );
  });

  test("allows split first deposits to use a distinct policy signature", async () => {
    const response = await POST(
      request(
        body({
          policyInitialization: "create",
          policySignature: "policy-sig-1",
        })
      )
    );

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        depositSignature: "deposit-sig-1",
        policyInitialization: "create",
        policySignature: "policy-sig-1",
      })
    );
    expect(getSignatureStatuses).toHaveBeenCalledWith(["deposit-sig-1"], {
      searchTransactionHistory: true,
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
          "policyAccount does not match the canonical earn deposit metadata.",
      },
    });
    expect(recordConfirmedYieldDeposit).not.toHaveBeenCalled();
  });

  test("returns 400 when policy initialization is missing", async () => {
    const payload = body();
    delete (payload as { policyInitialization?: unknown }).policyInitialization;

    const response = await POST(request(payload));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "policyInitialization must be a non-empty string.",
      },
    });
    expect(recordConfirmedYieldDeposit).not.toHaveBeenCalled();
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
    expect(recordConfirmedYieldDeposit).not.toHaveBeenCalled();
  });

  test("returns 400 when the confirmed signature has no slot", async () => {
    getSignatureStatuses.mockImplementationOnce(async () => ({
      value: [
        {
          confirmationStatus: "confirmed" as const,
          err: null,
          slot: null,
        },
      ],
    }));

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unconfirmed_signature",
        message: "Confirmed transaction slot is unavailable.",
      },
    });
    expect(recordConfirmedYieldDeposit).not.toHaveBeenCalled();
  });
});
