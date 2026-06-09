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
import type { SmartAccountPreparedEarnUsdcYieldRoutingPolicy } from "@loyal-labs/smart-account-vaults";
import { PublicKey, Connection } from "@solana/web3.js";

import { buildEarnPolicyConfirmRequestBody } from "@/lib/yield-optimization/earn-confirm-contracts.shared";
import {
  createYieldDepositRepositoryMock,
  recordConfirmedYieldRoutePolicy,
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
  const policySeed = "2";
  return {
    cluster: "devnet",
    confirmedSlot: "123",
    liquidityMint: earnTarget.liquidityMint.toBase58(),
    market: earnTarget.market.toBase58(),
    policyAccount: policyAccountForSeed(Number(policySeed)),
    policyId: policySeed,
    policySeed,
    policySignature: "policy-sig-1",
    settings: settings.toBase58(),
    targetReserve: earnTarget.reserve.toBase58(),
    vaultIndex: 1,
    vaultPubkey: vaultPubkey.toBase58(),
    walletAddress: walletAddress.toBase58(),
    ...overrides,
  };
}

function request(payload = body()) {
  return new Request(
    "https://app.askloyal.com/api/smart-accounts/yield-optimization/policies/confirm",
    {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}

function preparedPolicyFromBody(
  payload = body()
): SmartAccountPreparedEarnUsdcYieldRoutingPolicy {
  return {
    persistence: {
      cluster: payload.cluster,
      liquidityMint: payload.liquidityMint,
      market: payload.market,
      policyAccount: payload.policyAccount,
      policyId: payload.policyId,
      policySeed: payload.policySeed,
      settings: payload.settings,
      targetReserve: payload.targetReserve,
      vaultIndex: payload.vaultIndex,
      vaultPubkey: payload.vaultPubkey,
      walletAddress: payload.walletAddress,
    },
  } as SmartAccountPreparedEarnUsdcYieldRoutingPolicy;
}

describe("yield optimization policy confirm route", () => {
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
    recordConfirmedYieldRoutePolicy.mockClear();
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
    recordConfirmedYieldRoutePolicy.mockImplementation(async () => ({
      active: true,
      authority: walletAddress.toBase58(),
      delegatedSigners: [walletAddress.toBase58()],
      firstSeenAt: new Date("2026-06-01T00:00:00.000Z"),
      id: BigInt(55),
      kaminoLiquidityMints: [earnTarget.liquidityMint.toBase58()],
      kaminoMarkets: [earnTarget.market.toBase58()],
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
      lastSeenSignature: "policy-sig-1",
      lastSeenSlot: BigInt(123),
      policyAccount: policyAccountForSeed(2),
      policySeed: BigInt(2),
      riskProfile: "safe",
      routeModes: ["yield"],
      settings: settings.toBase58(),
      stableMints: [earnTarget.liquidityMint.toBase58()],
      swapLanes: [],
      threshold: 1,
      universePreset: "safe",
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
    }));
  });

  test("returns 401 without an authenticated wallet session", async () => {
    resolveAuthenticatedPrincipalFromRequest.mockImplementationOnce(
      async () => null as never
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(recordConfirmedYieldRoutePolicy).not.toHaveBeenCalled();
  });

  test("valid confirmed policy setup calls the repository with normalized input", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldRoutePolicy).toHaveBeenCalledWith({
      cluster: "devnet",
      confirmedSlot: BigInt(123),
      liquidityMint: earnTarget.liquidityMint.toBase58(),
      market: earnTarget.market.toBase58(),
      policyAccount: policyAccountForSeed(2),
      policyId: BigInt(2),
      policySeed: BigInt(2),
      policySignature: "policy-sig-1",
      settings: settings.toBase58(),
      targetReserve: earnTarget.reserve.toBase58(),
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
    expect(getSignatureStatuses).toHaveBeenCalledWith(["policy-sig-1"], {
      searchTransactionHistory: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      policy: {
        account: policyAccountForSeed(2),
        id: "55",
        seed: "2",
        vaultIndex: 1,
        vaultPubkey: vaultPubkey.toBase58(),
      },
    });
  });

  test("accepts a policy body built by the shared confirm contract", async () => {
    const response = await POST(
      request(
        buildEarnPolicyConfirmRequestBody({
          confirmedSlot: "123",
          preparedPolicy: preparedPolicyFromBody(),
          signature: "policy-sig-1",
        })
      )
    );

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldRoutePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        policySignature: "policy-sig-1",
      })
    );
  });

  test("accepts mainnet-beta policy metadata when configured env is mainnet", async () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "mainnet";
    const mainnetTarget = getKaminoUsdcEarnTargetForCluster(
      LoyalCluster.MainnetBeta
    );

    const response = await POST(
      request(
        body({
          cluster: "mainnet-beta",
          liquidityMint: mainnetTarget.liquidityMint.toBase58(),
          market: mainnetTarget.market.toBase58(),
          targetReserve: mainnetTarget.reserve.toBase58(),
        })
      )
    );

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldRoutePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster: "mainnet-beta",
        liquidityMint: mainnetTarget.liquidityMint.toBase58(),
        market: mainnetTarget.market.toBase58(),
        targetReserve: mainnetTarget.reserve.toBase58(),
      })
    );
  });

  test("normalizes legacy mainnet policy metadata before canonical comparison", async () => {
    process.env.NEXT_PUBLIC_SOLANA_ENV = "mainnet";
    const mainnetTarget = getKaminoUsdcEarnTargetForCluster(
      LoyalCluster.MainnetBeta
    );

    const response = await POST(
      request(
        body({
          cluster: "mainnet",
          liquidityMint: mainnetTarget.liquidityMint.toBase58(),
          market: mainnetTarget.market.toBase58(),
          targetReserve: mainnetTarget.reserve.toBase58(),
        })
      )
    );

    expect(response.status).toBe(200);
    expect(recordConfirmedYieldRoutePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster: "mainnet-beta",
      })
    );
  });

  test("returns 403 when request account refs do not match the principal", async () => {
    const response = await POST(
      request(body({ settings: "11111111111111111111111111111115" }))
    );

    expect(response.status).toBe(403);
    expect(recordConfirmedYieldRoutePolicy).not.toHaveBeenCalled();
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
          "policyAccount does not match the canonical earn policy metadata.",
      },
    });
    expect(recordConfirmedYieldRoutePolicy).not.toHaveBeenCalled();
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
    expect(recordConfirmedYieldRoutePolicy).not.toHaveBeenCalled();
  });
});
