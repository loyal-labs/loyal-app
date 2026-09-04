import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { serializeVerifiedDepositPosition } = await import(
  "./earn-deposit-confirm.server"
);
const { serializeVerifiedWithdrawPosition } = await import(
  "./earn-withdraw-confirm.server"
);
const { recordAutodepositCloseIntent, recordAutodepositSetupIntent } =
  await import("./earn-autodeposit-repository.server");

const now = new Date("2026-08-25T12:00:00.000Z");

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
