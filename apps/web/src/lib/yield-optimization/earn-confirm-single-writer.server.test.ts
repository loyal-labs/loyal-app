import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import {
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  getStablecoinMintForCluster,
  LoyalCluster,
  RiskBasket,
  Stablecoin,
} from "@loyal-labs/actions";

mock.module("server-only", () => ({}));

const { serializeVerifiedDepositPosition } = await import(
  "./earn-deposit-confirm.server"
);
const { serializeVerifiedWithdrawPosition } = await import(
  "./earn-withdraw-confirm.server"
);
const { recordAutodepositCloseIntent, recordAutodepositSetupIntent } =
  await import("./earn-autodeposit-repository.server");

// Exercise the real policy-confirm handler and parser. Only auth and the RPC
// boundary are substituted; no signed transaction or projection write occurs.
const policyPrincipal = {
  walletAddress: new PublicKey(10).toBase58(),
  settingsPda: new PublicKey(11).toBase58(),
};
let authenticated = true;
mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () =>
    authenticated ? policyPrincipal : null,
}));
mock.module("@/lib/core/config/solana-env-override", () => ({
  resolveLoyalWebSolanaEnvFromEnv: () => "mainnet",
}));
mock.module("@/lib/solana/rpc-endpoints.server", () => ({
  getServerSolanaEndpoints: () => ({
    rpcEndpoint: "http://127.0.0.1:8899",
    websocketEndpoint: "ws://127.0.0.1:8900",
  }),
}));
const policyStatus = spyOn(Connection.prototype, "getSignatureStatuses");
policyStatus.mockResolvedValue({
  context: { slot: 701 },
  value: [
    {
      slot: 700,
      confirmations: null,
      err: null,
      confirmationStatus: "finalized",
    },
  ],
});
afterAll(() => policyStatus.mockRestore());
const { POST: confirmPolicy } = await import(
  "@/app/api/smart-accounts/yield-optimization/policies/confirm/route"
);

const now = new Date("2026-08-25T12:00:00.000Z");

function policyBody(overrides: Record<string, unknown> = {}) {
  const settings = new PublicKey(policyPrincipal.settingsPda);
  const target = getKaminoUsdcEarnTargetForCluster(LoyalCluster.MainnetBeta);
  return {
    cluster: "mainnet-beta",
    stage: "route_policy",
    confirmedSlot: "700",
    delegatedSigner: new PublicKey(12).toBase58(),
    liquidityMint: target.liquidityMint.toBase58(),
    market: target.market.toBase58(),
    targetReserve: target.reserve.toBase58(),
    policyAccount: pda
      .getPolicyPda({ settingsPda: settings, policySeed: 46 })[0]
      .toBase58(),
    policyId: "46",
    policySeed: "46",
    policySignature: "confirmed-route-policy",
    setupPolicyAccount: pda
      .getPolicyPda({ settingsPda: settings, policySeed: 47 })[0]
      .toBase58(),
    setupPolicyId: "47",
    setupPolicySeed: "47",
    setupPolicySignature: "confirmed-setup-policy",
    setupPolicyConfirmedSlot: "700",
    settings: policyPrincipal.settingsPda,
    walletAddress: policyPrincipal.walletAddress,
    vaultIndex: 1,
    vaultPubkey: pda
      .getSmartAccountPda({ settingsPda: settings, accountIndex: 1 })[0]
      .toBase58(),
    ...overrides,
  };
}

function postPolicy(overrides: Record<string, unknown> = {}) {
  return confirmPolicy(
    new Request("http://localhost/policies/confirm", {
      method: "POST",
      body: JSON.stringify(policyBody(overrides)),
    })
  );
}

describe("policy setup confirmation matches prepared Safe products", () => {
  for (const stage of ["route_policy", "setup_policy"] as const) {
    test(`${stage}: accepts the legacy target and a different Safe target`, async () => {
      expect((await postPolicy({ stage })).status).toBe(200);
      const response = await postPolicy({
        stage,
        market: getRiskBasketMarketsForCluster(
          LoyalCluster.MainnetBeta,
          RiskBasket.Safe
        )[1].toBase58(),
        targetReserve: new PublicKey(20).toBase58(),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        policy: { seed: stage === "route_policy" ? "46" : "47", vaultIndex: 1 },
      });
    });
    test(`${stage}: accepts a prepared supported non-USDC product`, async () => {
      expect(
        (
          await postPolicy({
            stage,
            liquidityMint: getStablecoinMintForCluster(
              LoyalCluster.MainnetBeta,
              Stablecoin.USDT
            ).toBase58(),
            targetReserve: new PublicKey(21).toBase58(),
          })
        ).status
      ).toBe(200);
    });
  }

  test("retains mint, market, PDA, seed, vault, owner, cluster and slot fences", async () => {
    for (const overrides of [
      { liquidityMint: new PublicKey(22).toBase58() },
      { market: new PublicKey(23).toBase58() },
      { targetReserve: "not-a-public-key" },
      { policyAccount: new PublicKey(24).toBase58() },
      { policyId: "48" },
      { policySeed: "0" },
      { vaultIndex: 0 },
      { vaultPubkey: new PublicKey(25).toBase58() },
      { stage: "setup_policy", setupPolicySeed: "48" },
      { stage: "setup_policy", setupPolicySignature: null },
      { cluster: "devnet" },
      { confirmedSlot: "699" },
    ])
      expect((await postPolicy(overrides)).status).toBe(400);
    expect(
      (await postPolicy({ walletAddress: new PublicKey(26).toBase58() })).status
    ).toBe(403);
    authenticated = false;
    try {
      expect((await postPolicy()).status).toBe(401);
    } finally {
      authenticated = true;
    }
  });

  test("never acknowledges a failed transaction", async () => {
    policyStatus.mockResolvedValueOnce({
      context: { slot: 701 },
      value: [
        {
          slot: 700,
          confirmations: null,
          err: { InstructionError: [0, "InvalidArgument"] },
          confirmationStatus: "finalized",
        },
      ],
    });
    const response = await postPolicy();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "unconfirmed_signature" },
    });
  });
});

function depositInput() {
  return {
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(441610901),
    delegatedSigner: "delegate",
    depositMint: "mint",
    depositSignature: "deposit-signature",
    liquidityMint: "mint",
    market: "market",
    policyAccount: "policy",
    policyConfirmedSlot: BigInt(441610800),
    policyId: BigInt(7),
    policyInitialization: "reuse" as const,
    policySeed: BigInt(7),
    policySignature: "policy-signature",
    principalAmountRaw: BigInt(1_000_000),
    settings: "settings",
    smartAccountAddress: "vault",
    targetReserve: "reserve",
    targetSupplyApyBps: BigInt(500),
    vaultIndex: 1,
    vaultPubkey: "vault",
    walletAddress: "wallet",
  };
}

function withdrawalInput() {
  return {
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(441610901),
    delegatedSigner: "delegate",
    liquidityMint: "mint",
    market: "market",
    mode: "full" as const,
    policyAccount: "policy",
    policyId: BigInt(7),
    policySeed: BigInt(7),
    settings: "settings",
    smartAccountAddress: "vault",
    sourceAmountRaw: BigInt(1_000_000),
    targetReserve: "reserve",
    vaultIndex: 1,
    vaultPubkey: "vault",
    walletAddress: "wallet",
    withdrawalSignature: "withdrawal-signature",
    withdrawnAmountRaw: BigInt(1_000_000),
  };
}

function autodepositSetupInput() {
  return {
    amountPerPeriodRaw: BigInt(1_000_000),
    cluster: "mainnet-beta",
    confirmedSlot: BigInt(441610901),
    delegatedSigner: "delegate",
    expiryTimestamp: BigInt(1_800_000_000),
    liquidityMint: "mint",
    nonce: BigInt(3),
    periodLengthSeconds: BigInt(2_592_000),
    policyAccount: "policy",
    policyId: BigInt(9),
    policySeed: BigInt(9),
    recurringDelegation: "recurring",
    settings: "settings",
    setupSignature: "setup-signature",
    setupStage: "create_policy" as const,
    startTimestamp: BigInt(1_700_000_000),
    subscriptionAuthority: "subscription",
    subscriptionAuthorityInitialization: "exists" as const,
    subscriptionDelegatee: "vault",
    vaultIndex: 1 as const,
    vaultPubkey: "vault",
    vaultUsdcAta: "vault-ata",
    walletAddress: "wallet",
    walletBalanceFloorRaw: BigInt(500_000),
    walletUsdcAta: "wallet-ata",
  };
}

function makeSelect(result: unknown[]) {
  return () => ({
    from: () => ({
      where: () => ({
        limit: async () => result,
      }),
    }),
  });
}

describe("single-writer compatibility responses", () => {
  test("deposit response retains the released position shape without a database row", () => {
    expect(serializeVerifiedDepositPosition(depositInput(), now)).toEqual({
      currentHolding: {
        amountRaw: "1000000",
        liquidityMint: "mint",
        market: "market",
        observedAt: now.toISOString(),
        observedSlot: "441610901",
        provenance: {
          lastHoldingEventId: null,
          lastRebalanceDecisionId: null,
        },
        reserve: "reserve",
      },
      id: "deposit-signature",
      initialHolding: {
        liquidityMint: "mint",
        market: "market",
        reserve: "reserve",
        supplyApyBps: "500",
      },
      principalAmountRaw: "1000000",
      status: "active",
    });
  });

  test("full withdrawal response is determined by verified action, not projection timing", () => {
    const first = serializeVerifiedWithdrawPosition(withdrawalInput(), now);
    const replay = serializeVerifiedWithdrawPosition(withdrawalInput(), now);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      currentHolding: { amountRaw: "0", observedSlot: "441610901" },
      currentTotalAmountRaw: "0",
      id: "withdrawal-signature",
      principalAmountRaw: "0",
      status: "active",
    });
  });
});

describe("Autodeposit intent ownership", () => {
  test("setup upsert changes intent fields without updating projected fields", async () => {
    let inserted: Record<string, unknown> | null = null;
    let conflictSet: Record<string, unknown> | null = null;
    const target = { id: BigInt(1), ...autodepositSetupInput() };
    const db = {
      select: makeSelect([]),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserted = values;
          return {
            onConflictDoUpdate: (args: { set: Record<string, unknown> }) => {
              conflictSet = args.set;
              return { returning: async () => [target] };
            },
          };
        },
      }),
    };

    await recordAutodepositSetupIntent(autodepositSetupInput(), {
      client: { db },
      now: () => now,
    } as never);

    expect(inserted).toMatchObject({
      active: true,
      chainObservationSlot: BigInt(0),
      lastSeenSlot: BigInt(0),
      lifecycleStatus: "pending",
      policyConfirmedSlot: null,
      policySignature: null,
      recurringDelegationConfirmedSlot: null,
      recurringDelegationSignature: null,
      walletBalanceFloorRaw: BigInt(500_000),
    });
    expect(conflictSet as Record<string, unknown> | null).toEqual({
      active: true,
      maxAmountPerPeriod: BigInt(1_000_000),
      periodLengthSeconds: BigInt(2_592_000),
      recurringDelegationExpiryTimestamp: BigInt(1_800_000_000),
      recurringDelegationNonce: BigInt(3),
      startTimestamp: BigInt(1_700_000_000),
      walletBalanceFloorRaw: BigInt(500_000),
    });
  });

  test("close updates desired active and scheduling only", async () => {
    const existing = {
      ...autodepositSetupInput(),
      active: true,
      delegatedSigners: ["delegate"],
      id: BigInt(1),
      lifecycleStatus: "active",
      recurringDelegation: "recurring",
      wallet: "wallet",
    };
    let updateSet: Record<string, unknown> | null = null;
    const db = {
      execute: async () => ({ rows: [] }),
      select: makeSelect([existing]),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updateSet = values;
          return {
            where: () => ({
              returning: async () => [{ ...existing, ...values }],
            }),
          };
        },
      }),
    };

    await recordAutodepositCloseIntent(
      {
        closeSignature: "close-signature",
        cluster: "mainnet-beta",
        confirmedSlot: BigInt(441610902),
        delegatedSigner: "delegate",
        policyAccount: "policy",
        recurringDelegation: "recurring",
        settings: "settings",
        vaultIndex: 1,
        vaultPubkey: "vault",
        walletAddress: "wallet",
      },
      { client: { db }, now: () => now } as never
    );

    expect(updateSet as Record<string, unknown> | null).toEqual({
      active: false,
    });
  });
});
