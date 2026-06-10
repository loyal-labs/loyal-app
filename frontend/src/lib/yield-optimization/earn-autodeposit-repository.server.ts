import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type {
  ConfirmedEarnAutodepositCloseInput,
  ConfirmedEarnAutodepositSetupInput,
  EarnAutodepositSetupStage,
} from "./earn-autodeposit-prepare-contracts.shared";
import {
  balanceSweepExecutions,
  balanceSweepPolicies,
  balanceSweepTargets,
  balanceSweepWalletBalancesCurrent,
  getYieldOptimizationClient,
  type YieldOptimizationClient,
} from "./yield-neon-client.server";

export type {
  ConfirmedEarnAutodepositCloseInput,
  ConfirmedEarnAutodepositSetupInput,
  EarnAutodepositSetupStage,
};

export type BalanceSweepWalletBalanceCurrentInput = {
  accountDataHash: string;
  amountRaw: bigint;
  mint: string;
  observedAt?: Date;
  observedSlot: bigint;
  owner: string;
  rawEvidence?: Record<string, unknown> | null;
  source: string;
  sourceCommitment: string;
  targetId: bigint;
  wallet: string;
  walletUsdcAta: string;
};

export type BalanceSweepExecutionInput = {
  amountRaw: bigint;
  decodedAt?: Date | null;
  decodedEvidence?: Record<string, unknown> | null;
  dedupeKey: string;
  destinationPostBalanceRaw?: bigint | null;
  destinationPreBalanceRaw?: bigint | null;
  destinationVaultAta: string;
  rawEvidence?: Record<string, unknown> | null;
  receivedAt?: Date;
  signature: string;
  slot: bigint;
  sourceCommitment: string;
  sourcePostBalanceRaw?: bigint | null;
  sourcePreBalanceRaw?: bigint | null;
  sourceWalletAta: string;
  targetId: bigint;
};

export type BalanceSweepTargetRecord = typeof balanceSweepTargets.$inferSelect;
export type BalanceSweepPolicyRecord = typeof balanceSweepPolicies.$inferSelect;
export type BalanceSweepWalletBalanceCurrentRecord =
  typeof balanceSweepWalletBalancesCurrent.$inferSelect;
export type BalanceSweepExecutionRecord =
  typeof balanceSweepExecutions.$inferSelect;

type EarnAutodepositRepositoryDependencies = {
  client: YieldOptimizationClient;
  now: () => Date;
};

function createDependencies(): EarnAutodepositRepositoryDependencies {
  return {
    client: getYieldOptimizationClient(),
    now: () => new Date(),
  };
}

function assertSetupHasPolicy(input: ConfirmedEarnAutodepositSetupInput) {
  if (input.policyAccount.length === 0) {
    throw new Error("Autodeposit setup confirmation is missing policyAccount.");
  }
  if (input.policySeed <= BigInt(0) || input.policyId !== input.policySeed) {
    throw new Error("Autodeposit setup confirmation has an invalid policy id.");
  }
  if (input.walletBalanceFloorRaw < BigInt(0)) {
    throw new Error("Autodeposit wallet balance floor cannot be negative.");
  }
}

async function findTargetByPolicy(args: {
  client: YieldOptimizationClient;
  policyAccount: string;
}): Promise<BalanceSweepTargetRecord | null> {
  const [target] = await args.client.db
    .select()
    .from(balanceSweepTargets)
    .where(eq(balanceSweepTargets.policyAccount, args.policyAccount))
    .limit(1);

  return target ?? null;
}

function targetValuesFromSetup(
  input: ConfirmedEarnAutodepositSetupInput,
  balanceSweepPolicyId: bigint,
  now: Date,
  active: boolean,
  lifecycleStatus: "active" | "pending_delegation"
) {
  return {
    active,
    authority: input.walletAddress,
    balanceSweepPolicyId,
    closeSignature: null,
    closeSlot: null,
    closedAt: null,
    delegatedSigners: [input.delegatedSigner],
    firstSeenAt: now,
    lastSeenAt: now,
    lastSeenSignature: input.setupSignature,
    lastSeenSlot: input.confirmedSlot,
    lifecycleStatus,
    maxAmountPerPeriod: input.amountPerPeriodRaw,
    periodLengthSeconds: input.periodLengthSeconds,
    policyAccount: input.policyAccount,
    policySeed: input.policySeed,
    recurringDelegation: input.recurringDelegation,
    settings: input.settings,
    subscriptionAuthority: input.subscriptionAuthority,
    threshold: 1,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    vaultUsdcAta: input.vaultUsdcAta,
    wallet: input.walletAddress,
    walletBalanceFloorRaw: input.walletBalanceFloorRaw,
    walletUsdcAta: input.walletUsdcAta,
  };
}

function policyValuesFromSetup(
  input: ConfirmedEarnAutodepositSetupInput,
  now: Date
) {
  return {
    active: true,
    authority: input.walletAddress,
    closeSignature: null,
    closeSlot: null,
    closedAt: null,
    delegatedSigners: [input.delegatedSigner],
    firstSeenAt: now,
    lastSeenAt: now,
    lastSeenSignature: input.setupSignature,
    lastSeenSlot: input.confirmedSlot,
    liquidityMint: input.liquidityMint,
    maxAmountPerPeriod: input.amountPerPeriodRaw,
    policyAccount: input.policyAccount,
    policySeed: input.policySeed,
    policyType: "subscription_sweep",
    settings: input.settings,
    subscriptionAuthority: input.subscriptionAuthority,
    subscriptionDelegatee: input.subscriptionDelegatee,
    threshold: 1,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    vaultUsdcAta: input.vaultUsdcAta,
    walletUsdcAta: input.walletUsdcAta,
  };
}

async function upsertBalanceSweepPolicyFromSetup(args: {
  client: YieldOptimizationClient;
  input: ConfirmedEarnAutodepositSetupInput;
  now: Date;
}): Promise<BalanceSweepPolicyRecord> {
  const { client, input, now } = args;
  const values = policyValuesFromSetup(input, now);
  const [policy] = await client.db
    .insert(balanceSweepPolicies)
    .values(values)
    .onConflictDoUpdate({
      target: [balanceSweepPolicies.policyAccount],
      set: {
        active: true,
        closeSignature: null,
        closeSlot: null,
        closedAt: null,
        delegatedSigners: sql`excluded.delegated_signers`,
        lastSeenAt: now,
        lastSeenSignature: input.setupSignature,
        lastSeenSlot: input.confirmedSlot,
        liquidityMint: input.liquidityMint,
        maxAmountPerPeriod: input.amountPerPeriodRaw,
        policySeed: input.policySeed,
        policyType: "subscription_sweep",
        subscriptionAuthority: input.subscriptionAuthority,
        subscriptionDelegatee: input.subscriptionDelegatee,
        vaultPubkey: input.vaultPubkey,
        vaultUsdcAta: input.vaultUsdcAta,
        walletUsdcAta: input.walletUsdcAta,
      },
    })
    .returning();

  if (!policy) {
    throw new Error("Failed to record balance-sweep policy.");
  }

  return policy;
}

function isAlreadyNewerOrTerminal(
  existing: BalanceSweepTargetRecord | null,
  confirmedSlot: bigint
): boolean {
  if (!existing) {
    return false;
  }
  if (
    existing.lifecycleStatus === "closed" &&
    existing.closeSlot !== null &&
    existing.closeSlot >= confirmedSlot
  ) {
    return true;
  }
  return existing.lastSeenSlot >= confirmedSlot;
}

export async function recordPendingAutodepositSetup(
  input: ConfirmedEarnAutodepositSetupInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  assertSetupHasPolicy(input);
  if (input.setupStage === "create_recurring_delegation") {
    throw new Error("Recurring delegation confirmations must activate target.");
  }

  const { client } = dependencies;
  const now = dependencies.now();
  const existing = await findTargetByPolicy({
    client,
    policyAccount: input.policyAccount,
  });
  const policy = await upsertBalanceSweepPolicyFromSetup({
    client,
    input,
    now,
  });
  if (
    existing &&
    (existing.active ||
      existing.lifecycleStatus === "active" ||
      existing.lifecycleStatus === "closed" ||
      isAlreadyNewerOrTerminal(existing, input.confirmedSlot))
  ) {
    return existing;
  }

  const values = targetValuesFromSetup(
    input,
    policy.id,
    now,
    false,
    "pending_delegation"
  );
  const [target] = await client.db
    .insert(balanceSweepTargets)
    .values(values)
    .onConflictDoUpdate({
      target: [balanceSweepTargets.policyAccount],
      set: {
        active: false,
        balanceSweepPolicyId: policy.id,
        delegatedSigners: sql`excluded.delegated_signers`,
        lastSeenAt: now,
        lastSeenSignature: input.setupSignature,
        lastSeenSlot: input.confirmedSlot,
        lifecycleStatus: "pending_delegation",
        maxAmountPerPeriod: input.amountPerPeriodRaw,
        periodLengthSeconds: input.periodLengthSeconds,
        recurringDelegation: input.recurringDelegation,
        subscriptionAuthority: input.subscriptionAuthority,
        vaultPubkey: input.vaultPubkey,
        vaultUsdcAta: input.vaultUsdcAta,
        walletBalanceFloorRaw: input.walletBalanceFloorRaw,
        walletUsdcAta: input.walletUsdcAta,
      },
    })
    .returning();

  if (!target) {
    throw new Error("Failed to record pending autodeposit setup.");
  }

  return target;
}

export async function recordConfirmedAutodepositDelegation(
  input: ConfirmedEarnAutodepositSetupInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  assertSetupHasPolicy(input);
  if (input.setupStage !== "create_recurring_delegation") {
    throw new Error("Autodeposit activation requires recurring delegation.");
  }

  const { client } = dependencies;
  const now = dependencies.now();
  const existing = await findTargetByPolicy({
    client,
    policyAccount: input.policyAccount,
  });
  const policy = await upsertBalanceSweepPolicyFromSetup({
    client,
    input,
    now,
  });
  if (
    existing &&
    existing.lifecycleStatus === "closed" &&
    isAlreadyNewerOrTerminal(existing, input.confirmedSlot)
  ) {
    return existing;
  }

  const values = targetValuesFromSetup(input, policy.id, now, true, "active");
  const [target] = await client.db
    .insert(balanceSweepTargets)
    .values(values)
    .onConflictDoUpdate({
      target: [balanceSweepTargets.policyAccount],
      set: {
        active: true,
        balanceSweepPolicyId: policy.id,
        closeSignature: null,
        closeSlot: null,
        closedAt: null,
        delegatedSigners: sql`excluded.delegated_signers`,
        lastSeenAt: now,
        lastSeenSignature: input.setupSignature,
        lastSeenSlot: input.confirmedSlot,
        lifecycleStatus: "active",
        maxAmountPerPeriod: input.amountPerPeriodRaw,
        periodLengthSeconds: input.periodLengthSeconds,
        recurringDelegation: input.recurringDelegation,
        subscriptionAuthority: input.subscriptionAuthority,
        vaultPubkey: input.vaultPubkey,
        vaultUsdcAta: input.vaultUsdcAta,
        walletBalanceFloorRaw: input.walletBalanceFloorRaw,
        walletUsdcAta: input.walletUsdcAta,
      },
    })
    .returning();

  if (!target) {
    throw new Error("Failed to record confirmed autodeposit delegation.");
  }

  return target;
}

export async function recordClosedAutodepositTarget(
  input: ConfirmedEarnAutodepositCloseInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  const { client } = dependencies;
  const now = dependencies.now();
  const existing = await findTargetByPolicy({
    client,
    policyAccount: input.policyAccount,
  });

  if (!existing) {
    throw new Error("Autodeposit target does not exist.");
  }
  if (
    existing.settings !== input.settings ||
    existing.wallet !== input.walletAddress ||
    existing.vaultIndex !== input.vaultIndex ||
    existing.vaultPubkey !== input.vaultPubkey
  ) {
    throw new Error("Autodeposit close target does not match the wallet.");
  }
  if (!existing.delegatedSigners.includes(input.delegatedSigner)) {
    throw new Error("Autodeposit close signer does not match target policy.");
  }
  if (
    existing.recurringDelegation &&
    existing.recurringDelegation !== input.recurringDelegation
  ) {
    throw new Error("Autodeposit recurring delegation does not match target.");
  }
  if (
    existing.lifecycleStatus === "closed" &&
    existing.closeSlot !== null &&
    existing.closeSlot >= input.confirmedSlot
  ) {
    return existing;
  }

  await client.db
    .update(balanceSweepPolicies)
    .set({
      active: false,
      closeSignature: input.closeSignature,
      closeSlot: input.confirmedSlot,
      closedAt: now,
      lastSeenAt: now,
      lastSeenSignature: input.closeSignature,
      lastSeenSlot: input.confirmedSlot,
    })
    .where(eq(balanceSweepPolicies.policyAccount, input.policyAccount));

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: false,
      closeSignature: input.closeSignature,
      closeSlot: input.confirmedSlot,
      closedAt: now,
      lastSeenAt: now,
      lastSeenSignature: input.closeSignature,
      lastSeenSlot: input.confirmedSlot,
      lifecycleStatus: "closed",
      recurringDelegation: input.recurringDelegation,
    })
    .where(eq(balanceSweepTargets.policyAccount, input.policyAccount))
    .returning();

  if (!target) {
    throw new Error("Failed to close autodeposit target.");
  }

  return target;
}

export async function upsertBalanceSweepWalletBalanceCurrent(
  input: BalanceSweepWalletBalanceCurrentInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepWalletBalanceCurrentRecord> {
  const { client } = dependencies;
  const now = dependencies.now();
  const existing = await client.db
    .select()
    .from(balanceSweepWalletBalancesCurrent)
    .where(eq(balanceSweepWalletBalancesCurrent.targetId, input.targetId))
    .limit(1);
  if (existing[0] && existing[0].observedSlot > input.observedSlot) {
    return existing[0];
  }

  const observedAt = input.observedAt ?? now;
  const [projection] = await client.db
    .insert(balanceSweepWalletBalancesCurrent)
    .values({
      accountDataHash: input.accountDataHash,
      amountRaw: input.amountRaw,
      mint: input.mint,
      observedAt,
      observedSlot: input.observedSlot,
      owner: input.owner,
      rawEvidence: input.rawEvidence ?? null,
      source: input.source,
      sourceCommitment: input.sourceCommitment,
      targetId: input.targetId,
      updatedAt: now,
      wallet: input.wallet,
      walletUsdcAta: input.walletUsdcAta,
    })
    .onConflictDoUpdate({
      target: [balanceSweepWalletBalancesCurrent.targetId],
      set: {
        accountDataHash: input.accountDataHash,
        amountRaw: input.amountRaw,
        mint: input.mint,
        observedAt,
        observedSlot: input.observedSlot,
        owner: input.owner,
        rawEvidence: input.rawEvidence ?? null,
        source: input.source,
        sourceCommitment: input.sourceCommitment,
        updatedAt: now,
        wallet: input.wallet,
        walletUsdcAta: input.walletUsdcAta,
      },
    })
    .returning();

  if (!projection) {
    throw new Error("Failed to upsert balance-sweep wallet projection.");
  }

  return projection;
}

export async function recordBalanceSweepExecution(
  input: BalanceSweepExecutionInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepExecutionRecord> {
  const { client } = dependencies;
  const now = dependencies.now();
  const inserted = await client.db
    .insert(balanceSweepExecutions)
    .values({
      amountRaw: input.amountRaw,
      decodedAt: input.decodedAt ?? null,
      decodedEvidence: input.decodedEvidence ?? null,
      dedupeKey: input.dedupeKey,
      destinationPostBalanceRaw: input.destinationPostBalanceRaw ?? null,
      destinationPreBalanceRaw: input.destinationPreBalanceRaw ?? null,
      destinationVaultAta: input.destinationVaultAta,
      insertedAt: now,
      rawEvidence: input.rawEvidence ?? null,
      receivedAt: input.receivedAt ?? now,
      signature: input.signature,
      slot: input.slot,
      sourceCommitment: input.sourceCommitment,
      sourcePostBalanceRaw: input.sourcePostBalanceRaw ?? null,
      sourcePreBalanceRaw: input.sourcePreBalanceRaw ?? null,
      sourceWalletAta: input.sourceWalletAta,
      targetId: input.targetId,
    })
    .onConflictDoNothing({
      target: [balanceSweepExecutions.dedupeKey],
    })
    .returning();

  if (inserted[0]) {
    return inserted[0];
  }

  const [existing] = await client.db
    .select()
    .from(balanceSweepExecutions)
    .where(
      and(
        eq(balanceSweepExecutions.dedupeKey, input.dedupeKey),
        eq(balanceSweepExecutions.targetId, input.targetId)
      )
    )
    .limit(1);

  if (!existing) {
    throw new Error("Failed to record balance-sweep execution.");
  }

  return existing;
}
