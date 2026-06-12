import "server-only";

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import type {
  ConfirmedEarnAutodepositCloseInput,
  ConfirmedEarnAutodepositSetupInput,
  EarnAutodepositSetupStage,
} from "./earn-autodeposit-prepare-contracts.shared";
import {
  balanceSweepExecutions,
  balanceSweepLotClaimItems,
  balanceSweepLotClaims,
  balanceSweepPolicies,
  balanceSweepSurplusLots,
  balanceSweepTargets,
  balanceSweepWalletBalanceEvents,
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
export type PendingEarnAutodepositScheduledSweepRecord = Pick<
  typeof balanceSweepSurplusLots.$inferSelect,
  | "classification"
  | "confidence"
  | "eligibleAfter"
  | "id"
  | "originalAmountRaw"
  | "reason"
  | "remainingAmountRaw"
  | "status"
>;

export type ImmediateEarnAutodepositScheduledSweepRequestResult = {
  acceleratedAmountRaw: bigint;
  acceleratedLotCount: number;
  eligibleAfter: Date;
  targetId: bigint;
};

export type CurrentEarnAutodepositState = {
  policy: BalanceSweepPolicyRecord;
  status: "active" | "paused" | "pending";
  target: BalanceSweepTargetRecord;
};

export type EarnAutodepositHistoryEventRecord = {
  actionType: "balance_sweep" | "close" | "create";
  amountRaw: bigint;
  confirmedAt: Date;
  confirmedSlot: bigint;
  depositSignature: string | null;
  id: string;
  policyAccount: string;
  recurringDelegation: string | null;
  signature: string;
  type: "autodeposit_action";
  walletBalanceFloorRaw: bigint | null;
};

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

function resolveEarnAutodepositStatus(
  target: Pick<BalanceSweepTargetRecord, "active" | "lifecycleStatus">
): CurrentEarnAutodepositState["status"] {
  if (target.lifecycleStatus === "active") {
    return target.active ? "active" : "paused";
  }
  return "pending";
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

export async function cancelScheduledAutodepositTransactionsForClose(args: {
  client: YieldOptimizationClient;
  targetId: bigint;
  now: Date;
}) {
  await args.client.db.execute(sql`
    WITH scheduled_slots AS (
      SELECT DISTINCT event.observed_slot
      FROM ${balanceSweepSurplusLots} lot
      INNER JOIN ${balanceSweepWalletBalanceEvents} event
        ON event.event_id = lot.source_event_id
      WHERE lot.target_id = ${args.targetId}
        AND lot.status IN ('open', 'selected')
        AND lot.remaining_amount_raw > 0
      UNION
      SELECT DISTINCT event.observed_slot
      FROM ${balanceSweepLotClaims} claim
      INNER JOIN ${balanceSweepLotClaimItems} item
        ON item.claim_token = claim.claim_token
      INNER JOIN ${balanceSweepSurplusLots} lot
        ON lot.id = item.lot_id
      INNER JOIN ${balanceSweepWalletBalanceEvents} event
        ON event.event_id = lot.source_event_id
      WHERE claim.target_id = ${args.targetId}
        AND claim.status = 'selected'
    ),
    scoped_lots AS (
      SELECT lot.id
      FROM ${balanceSweepSurplusLots} lot
      INNER JOIN ${balanceSweepWalletBalanceEvents} event
        ON event.event_id = lot.source_event_id
      INNER JOIN scheduled_slots
        ON scheduled_slots.observed_slot = event.observed_slot
      WHERE lot.target_id = ${args.targetId}
    ),
    selected_claims AS (
      SELECT ${balanceSweepLotClaims.claimToken} AS claim_token
      FROM ${balanceSweepLotClaims}
      WHERE ${balanceSweepLotClaims.targetId} = ${args.targetId}
        AND ${balanceSweepLotClaims.status} = 'selected'
        AND EXISTS (
          SELECT 1
          FROM ${balanceSweepLotClaimItems} scoped_item
          INNER JOIN scoped_lots
            ON scoped_lots.id = scoped_item.lot_id
          WHERE scoped_item.claim_token = ${balanceSweepLotClaims.claimToken}
        )
    ),
    restored_amounts AS (
      SELECT
        ${balanceSweepLotClaimItems.lotId} AS lot_id,
        SUM(${balanceSweepLotClaimItems.amountRaw})::bigint AS amount_raw
      FROM ${balanceSweepLotClaimItems}
      INNER JOIN selected_claims
        ON selected_claims.claim_token = ${balanceSweepLotClaimItems.claimToken}
      GROUP BY ${balanceSweepLotClaimItems.lotId}
    ),
    restored_lots AS (
      UPDATE ${balanceSweepSurplusLots}
      SET
        remaining_amount_raw = ${balanceSweepSurplusLots.remainingAmountRaw} + restored_amounts.amount_raw,
        status = CASE
          WHEN ${balanceSweepSurplusLots.status} = 'suppressed'
            THEN ${balanceSweepSurplusLots.status}
          ELSE 'open'::loyal_yield.balance_sweep_surplus_lot_status
        END,
        updated_at = ${args.now}
      FROM restored_amounts
      WHERE ${balanceSweepSurplusLots.id} = restored_amounts.lot_id
        AND ${balanceSweepSurplusLots.targetId} = ${args.targetId}
        AND ${balanceSweepSurplusLots.id} IN (
          SELECT id FROM scoped_lots
        )
      RETURNING ${balanceSweepSurplusLots.id}
    ),
    released_claims AS (
      UPDATE ${balanceSweepLotClaims}
      SET
        status = 'released',
        updated_at = ${args.now}
      WHERE ${balanceSweepLotClaims.claimToken} IN (
        SELECT claim_token FROM selected_claims
      )
      RETURNING ${balanceSweepLotClaims.claimToken}
    )
    UPDATE ${balanceSweepSurplusLots}
    SET
      status = 'suppressed',
      updated_at = ${args.now}
    WHERE ${balanceSweepSurplusLots.targetId} = ${args.targetId}
      AND ${balanceSweepSurplusLots.id} IN (
        SELECT id FROM scoped_lots
      )
      AND ${balanceSweepSurplusLots.status} IN ('open', 'selected')
      AND ${balanceSweepSurplusLots.remainingAmountRaw} > 0
  `);
}

export async function findCurrentEarnAutodepositState(
  input: {
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<CurrentEarnAutodepositState | null> {
  const [row] = await dependencies.client.db
    .select({
      policy: balanceSweepPolicies,
      target: balanceSweepTargets,
    })
    .from(balanceSweepPolicies)
    .innerJoin(
      balanceSweepTargets,
      eq(balanceSweepTargets.balanceSweepPolicyId, balanceSweepPolicies.id)
    )
    .where(
      and(
        eq(balanceSweepPolicies.active, true),
        eq(balanceSweepPolicies.authority, input.walletAddress),
        eq(balanceSweepPolicies.settings, input.settings),
        eq(balanceSweepPolicies.policyType, "subscription_sweep"),
        eq(balanceSweepPolicies.vaultIndex, input.vaultIndex),
        eq(balanceSweepTargets.wallet, input.walletAddress),
        eq(balanceSweepTargets.settings, input.settings),
        eq(balanceSweepTargets.vaultIndex, input.vaultIndex),
        ne(balanceSweepTargets.lifecycleStatus, "closed")
      )
    )
    .orderBy(
      sql`CASE WHEN ${balanceSweepTargets.active} = true AND ${balanceSweepTargets.lifecycleStatus} = 'active' THEN 0 ELSE 1 END`,
      desc(balanceSweepTargets.lastSeenSlot)
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    policy: row.policy,
    status: resolveEarnAutodepositStatus(row.target),
    target: row.target,
  };
}

export function resolveEarnAutodepositCurrentPeriodStart(
  target: Pick<
    BalanceSweepTargetRecord,
    "periodLengthSeconds" | "startTimestamp"
  >,
  now: Date
): Date | null {
  if (target.startTimestamp === null) {
    return null;
  }

  const startMs = Number(target.startTimestamp * BigInt(1000));
  if (!Number.isFinite(startMs)) {
    return null;
  }

  if (
    target.periodLengthSeconds === null ||
    target.periodLengthSeconds <= BigInt(0)
  ) {
    return new Date(startMs);
  }

  const periodMs = Number(target.periodLengthSeconds * BigInt(1000));
  const nowMs = now.getTime();
  if (!Number.isFinite(periodMs) || nowMs < startMs) {
    return new Date(startMs);
  }

  const periodsElapsed = Math.floor((nowMs - startMs) / periodMs);
  return new Date(startMs + periodsElapsed * periodMs);
}

export async function sumEarnAutodepositCurrentPeriodDeposits(
  target: Pick<
    BalanceSweepTargetRecord,
    "id" | "periodLengthSeconds" | "startTimestamp"
  >,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<bigint> {
  const periodStart = resolveEarnAutodepositCurrentPeriodStart(
    target,
    dependencies.now()
  );
  const conditions = [eq(balanceSweepExecutions.targetId, target.id)];
  if (periodStart) {
    conditions.push(
      sql`coalesce(${balanceSweepExecutions.decodedAt}, ${balanceSweepExecutions.receivedAt}) >= ${periodStart}`
    );
  }

  const [row] = await dependencies.client.db
    .select({
      totalRaw: sql<string | null>`sum(${balanceSweepExecutions.amountRaw})`,
    })
    .from(balanceSweepExecutions)
    .where(and(...conditions));

  return row?.totalRaw ? BigInt(row.totalRaw) : BigInt(0);
}

export async function findPendingEarnAutodepositScheduledSweeps(
  target: Pick<BalanceSweepTargetRecord, "id">,
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<PendingEarnAutodepositScheduledSweepRecord[]> {
  return dependencies.client.db
    .select({
      classification: balanceSweepSurplusLots.classification,
      confidence: balanceSweepSurplusLots.confidence,
      eligibleAfter: balanceSweepSurplusLots.eligibleAfter,
      id: balanceSweepSurplusLots.id,
      originalAmountRaw: balanceSweepSurplusLots.originalAmountRaw,
      reason: balanceSweepSurplusLots.reason,
      remainingAmountRaw: balanceSweepSurplusLots.remainingAmountRaw,
      status: balanceSweepSurplusLots.status,
    })
    .from(balanceSweepSurplusLots)
    .where(
      and(
        eq(balanceSweepSurplusLots.targetId, target.id),
        eq(balanceSweepSurplusLots.status, "open"),
        sql`${balanceSweepSurplusLots.remainingAmountRaw} > 0`
      )
    )
    .orderBy(
      asc(balanceSweepSurplusLots.eligibleAfter),
      asc(balanceSweepSurplusLots.createdAt),
      asc(balanceSweepSurplusLots.id)
    );
}

export async function requestImmediateEarnAutodepositScheduledSweep(
  state: CurrentEarnAutodepositState,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<ImmediateEarnAutodepositScheduledSweepRequestResult | null> {
  if (state.status !== "active") {
    throw new Error("Autodeposit target is not active.");
  }

  const now = dependencies.now();
  const updatedLots = await dependencies.client.db
    .update(balanceSweepSurplusLots)
    .set({
      confidence: "user_requested",
      eligibleAfter: sql`LEAST(${balanceSweepSurplusLots.eligibleAfter}, ${now})`,
      reason: sql`CASE
        WHEN ${balanceSweepSurplusLots.reason} LIKE 'user requested immediate autodeposit sweep;%'
          THEN ${balanceSweepSurplusLots.reason}
        ELSE concat('user requested immediate autodeposit sweep; ', ${balanceSweepSurplusLots.reason})
      END`,
      updatedAt: now,
    })
    .where(
      and(
        eq(balanceSweepSurplusLots.targetId, state.target.id),
        eq(balanceSweepSurplusLots.status, "open"),
        sql`${balanceSweepSurplusLots.remainingAmountRaw} > 0`
      )
    )
    .returning({
      eligibleAfter: balanceSweepSurplusLots.eligibleAfter,
      remainingAmountRaw: balanceSweepSurplusLots.remainingAmountRaw,
    });

  if (updatedLots.length === 0) {
    return null;
  }

  let acceleratedAmountRaw = BigInt(0);
  let eligibleAfter = updatedLots[0]?.eligibleAfter ?? now;
  for (const lot of updatedLots) {
    acceleratedAmountRaw += lot.remainingAmountRaw;
    if (lot.eligibleAfter < eligibleAfter) {
      eligibleAfter = lot.eligibleAfter;
    }
  }

  return {
    acceleratedAmountRaw,
    acceleratedLotCount: updatedLots.length,
    eligibleAfter,
    targetId: state.target.id,
  };
}

export async function findEarnAutodepositHistoryEvents(
  input: {
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<EarnAutodepositHistoryEventRecord[]> {
  const [targets, executions] = await Promise.all([
    dependencies.client.db
      .select()
      .from(balanceSweepTargets)
      .where(
        and(
          eq(balanceSweepTargets.settings, input.settings),
          eq(balanceSweepTargets.vaultIndex, input.vaultIndex),
          eq(balanceSweepTargets.wallet, input.walletAddress)
        )
      ),
    dependencies.client.db
      .select({
        execution: balanceSweepExecutions,
        target: balanceSweepTargets,
      })
      .from(balanceSweepExecutions)
      .innerJoin(
        balanceSweepTargets,
        eq(balanceSweepExecutions.targetId, balanceSweepTargets.id)
      )
      .where(
        and(
          eq(balanceSweepTargets.settings, input.settings),
          eq(balanceSweepTargets.vaultIndex, input.vaultIndex),
          eq(balanceSweepTargets.wallet, input.walletAddress)
        )
      ),
  ]);

  const targetEvents = targets.flatMap((target) => {
    const history: EarnAutodepositHistoryEventRecord[] = [];

    if (target.closeSignature === null) {
      history.push({
        actionType: "create",
        amountRaw: BigInt(0),
        confirmedAt: target.lastSeenAt,
        confirmedSlot: target.lastSeenSlot,
        depositSignature: null,
        id: `autodeposit:create:${target.id.toString()}`,
        policyAccount: target.policyAccount,
        recurringDelegation: target.recurringDelegation,
        signature: target.lastSeenSignature,
        type: "autodeposit_action",
        walletBalanceFloorRaw: target.walletBalanceFloorRaw,
      });
    }

    if (
      target.closeSignature !== null &&
      target.closeSlot !== null &&
      target.closedAt !== null
    ) {
      history.push({
        actionType: "close",
        amountRaw: BigInt(0),
        confirmedAt: target.closedAt,
        confirmedSlot: target.closeSlot,
        depositSignature: null,
        id: `autodeposit:close:${target.id.toString()}`,
        policyAccount: target.policyAccount,
        recurringDelegation: target.recurringDelegation,
        signature: target.closeSignature,
        type: "autodeposit_action",
        walletBalanceFloorRaw: target.walletBalanceFloorRaw,
      });
    }

    return history;
  });
  const sweepEvents = executions.map(({ execution, target }) => ({
    actionType: "balance_sweep" as const,
    amountRaw: execution.amountRaw,
    confirmedAt: execution.decodedAt ?? execution.receivedAt,
    confirmedSlot: execution.slot,
    depositSignature:
      typeof execution.decodedEvidence?.kaminoDepositSignature === "string"
        ? execution.decodedEvidence.kaminoDepositSignature
        : null,
    id: `autodeposit:sweep:${execution.id.toString()}`,
    policyAccount: target.policyAccount,
    recurringDelegation: target.recurringDelegation,
    signature: execution.signature,
    type: "autodeposit_action" as const,
    walletBalanceFloorRaw: target.walletBalanceFloorRaw,
  }));
  const events = [...targetEvents, ...sweepEvents];

  return events.sort((a, b) => {
    const confirmedAtDelta = b.confirmedAt.getTime() - a.confirmedAt.getTime();
    if (confirmedAtDelta !== 0) {
      return confirmedAtDelta;
    }
    if (a.confirmedSlot !== b.confirmedSlot) {
      return a.confirmedSlot > b.confirmedSlot ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
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
    startTimestamp: input.startTimestamp,
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

function assertClosedTargetCanReceiveSetup(
  existing: BalanceSweepTargetRecord | null,
  confirmedSlot: bigint
): BalanceSweepTargetRecord | null {
  if (existing?.lifecycleStatus !== "closed") {
    return null;
  }
  if (existing.closeSlot !== null && existing.closeSlot >= confirmedSlot) {
    return existing;
  }
  throw new Error(
    "Closed autodeposit targets cannot be reactivated. Create a new autodeposit policy with a new policy seed."
  );
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
  const closedTarget = assertClosedTargetCanReceiveSetup(
    existing,
    input.confirmedSlot
  );
  if (closedTarget) {
    return closedTarget;
  }
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
        startTimestamp: input.startTimestamp,
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
  const closedTarget = assertClosedTargetCanReceiveSetup(
    existing,
    input.confirmedSlot
  );
  if (closedTarget) {
    return closedTarget;
  }
  const policy = await upsertBalanceSweepPolicyFromSetup({
    client,
    input,
    now,
  });

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
        startTimestamp: input.startTimestamp,
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
    await cancelScheduledAutodepositTransactionsForClose({
      client,
      now,
      targetId: existing.id,
    });
    return existing;
  }

  await cancelScheduledAutodepositTransactionsForClose({
    client,
    now,
    targetId: existing.id,
  });

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

export async function updateAutodepositWalletBalanceFloor(
  input: {
    policyAccount: string;
    recurringDelegation: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
    walletBalanceFloorRaw: bigint;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  if (input.walletBalanceFloorRaw < BigInt(0)) {
    throw new Error("Autodeposit wallet balance floor cannot be negative.");
  }

  const { client } = dependencies;
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
    existing.vaultIndex !== input.vaultIndex
  ) {
    throw new Error("Autodeposit target does not match the wallet.");
  }
  if (existing.lifecycleStatus === "closed") {
    throw new Error("Closed autodeposit targets cannot be updated.");
  }
  if (
    existing.recurringDelegation &&
    existing.recurringDelegation !== input.recurringDelegation
  ) {
    throw new Error("Autodeposit recurring delegation does not match target.");
  }

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      walletBalanceFloorRaw: input.walletBalanceFloorRaw,
    })
    .where(eq(balanceSweepTargets.policyAccount, input.policyAccount))
    .returning();

  if (!target) {
    throw new Error("Failed to update autodeposit wallet balance floor.");
  }

  return target;
}

export async function updateAutodepositTargetActive(
  input: {
    active: boolean;
    policyAccount: string;
    recurringDelegation: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  const { client } = dependencies;
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
    existing.vaultIndex !== input.vaultIndex
  ) {
    throw new Error("Autodeposit target does not match the wallet.");
  }
  if (existing.lifecycleStatus === "closed") {
    throw new Error("Closed autodeposit targets cannot be toggled.");
  }
  if (existing.lifecycleStatus !== "active") {
    throw new Error("Pending autodeposit targets cannot be toggled.");
  }
  if (
    !existing.recurringDelegation ||
    existing.recurringDelegation !== input.recurringDelegation
  ) {
    throw new Error("Autodeposit recurring delegation does not match target.");
  }

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: input.active,
    })
    .where(eq(balanceSweepTargets.policyAccount, input.policyAccount))
    .returning();

  if (!target) {
    throw new Error("Failed to update autodeposit target active state.");
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
