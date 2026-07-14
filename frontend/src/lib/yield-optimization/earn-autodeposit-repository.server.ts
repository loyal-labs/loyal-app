import "server-only";

import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";

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
  balanceSweepScheduledSlots,
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
  walletTokenAta: string;
  walletUsdcAta: string;
};

export type BalanceSweepExecutionInput = {
  amountRaw: bigint;
  decodedAt?: Date | null;
  decodedEvidence?: Record<string, unknown> | null;
  dedupeKey: string;
  destinationPostBalanceRaw?: bigint | null;
  destinationPreBalanceRaw?: bigint | null;
  destinationTokenAta: string;
  destinationVaultAta: string;
  rawEvidence?: Record<string, unknown> | null;
  receivedAt?: Date;
  signature: string;
  slot: bigint;
  sourceCommitment: string;
  sourcePostBalanceRaw?: bigint | null;
  sourcePreBalanceRaw?: bigint | null;
  sourceTokenAta: string;
  sourceWalletAta: string;
  targetId: bigint;
  tokenMint: string;
};

export type EarnAutodepositBootstrapWalletBalanceSnapshot = {
  accountDataHash: string;
  amountRaw: bigint;
  mint: string;
  observedAt: Date;
  observedSlot: bigint;
  owner: string;
  rawEvidence?: Record<string, unknown> | null;
  source: string;
  sourceCommitment: string;
};

type BalanceSweepTargetRow = typeof balanceSweepTargets.$inferSelect;
type BalanceSweepTargetResumeMetadataKey =
  | "cluster"
  | "policyConfirmedSlot"
  | "policySignature"
  | "recurringDelegationConfirmedSlot"
  | "recurringDelegationExpiryTimestamp"
  | "recurringDelegationNonce"
  | "recurringDelegationSignature";
export type BalanceSweepTargetRecord = Omit<
  BalanceSweepTargetRow,
  BalanceSweepTargetResumeMetadataKey
> &
  Partial<Pick<BalanceSweepTargetRow, BalanceSweepTargetResumeMetadataKey>>;
export type BalanceSweepPolicyRecord = typeof balanceSweepPolicies.$inferSelect;
export type BalanceSweepWalletBalanceCurrentRecord =
  typeof balanceSweepWalletBalancesCurrent.$inferSelect;
export type BalanceSweepExecutionRecord =
  typeof balanceSweepExecutions.$inferSelect;
export type PendingEarnAutodepositScheduledSweepRecord = {
  classification: string;
  confidence: string;
  eligibleAfter: Date;
  executeNowAvailableAt: Date | null;
  id: bigint;
  lotCount: number;
  originalAmountRaw: bigint;
  reason: string;
  remainingAmountRaw: bigint;
  slotId: bigint;
  status: string;
};

export type EarnAutodepositScheduledSweepProgressRecord = {
  completedAt: Date | null;
  completionFailureCode: string | null;
  eventId: bigint | null;
  occurredAt: Date;
  slotId: bigint;
  status: string;
};

export type ImmediateEarnAutodepositScheduledSweepRequestResult = {
  acceleratedAmountRaw: bigint;
  acceleratedLotCount: number;
  eligibleAfter: Date;
  slotId: bigint;
  status: string;
  targetId: bigint;
};

export type EarnAutodepositBootstrapSweepResult =
  | {
      status: "scheduled" | "already_exists";
      sweep: PendingEarnAutodepositScheduledSweepRecord;
    }
  | {
      reason: string;
      status: "skipped";
    };

export type EarnAutodepositFloorRebaselineSweepResult =
  | {
      status: "scheduled";
      sweep: PendingEarnAutodepositScheduledSweepRecord;
    }
  | {
      reason:
        | "wallet_balance_projection_missing"
        | "wallet_balance_at_or_below_floor";
      status: "skipped";
    };

export type EarnAutodepositWalletBalanceFloorUpdateResult = {
  rebaselineSweep: EarnAutodepositFloorRebaselineSweepResult;
  target: BalanceSweepTargetRecord;
};

export type CurrentEarnAutodepositState = {
  policy: BalanceSweepPolicyRecord | null;
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

type ImmediateEarnAutodepositScheduledSweepRequestOptions = {
  slotId?: bigint | null;
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

// System pause distinct from the user toggle: the wallet's Earn route policy
// pair is gone (a full withdrawal closed the position), so the sweep worker
// can never execute for this target. The dedicated lifecycle value lets the
// state reconcile auto-resume it once a deposit recreates the policy pair —
// a plain toggle-off (active=false, lifecycle "active") stays user-owned.
export const EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION =
  "paused_missing_position" as const;

export function resolveEarnAutodepositStatus(
  target: Pick<BalanceSweepTargetRecord, "active" | "lifecycleStatus">
): CurrentEarnAutodepositState["status"] {
  if (target.lifecycleStatus === "active") {
    return target.active ? "active" : "paused";
  }
  if (target.lifecycleStatus === EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION) {
    return "paused";
  }
  return "pending";
}

function hasRecordedAutodepositPolicy(
  target: Pick<
    BalanceSweepTargetRecord,
    "policyConfirmedSlot" | "policySignature"
  >
): boolean {
  return Boolean(
    target.policySignature &&
      target.policyConfirmedSlot !== undefined &&
      target.policyConfirmedSlot !== null
  );
}

function hasRecordedAutodepositDelegation(
  target: Pick<
    BalanceSweepTargetRecord,
    "recurringDelegationConfirmedSlot" | "recurringDelegationSignature"
  >
): boolean {
  return Boolean(
    target.recurringDelegationSignature &&
      target.recurringDelegationConfirmedSlot !== undefined &&
      target.recurringDelegationConfirmedSlot !== null
  );
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

async function findTargetByRecurringDelegation(args: {
  client: YieldOptimizationClient;
  recurringDelegation: string;
}): Promise<BalanceSweepTargetRecord | null> {
  const [target] = await args.client.db
    .select()
    .from(balanceSweepTargets)
    .where(
      eq(balanceSweepTargets.recurringDelegation, args.recurringDelegation)
    )
    .limit(1);

  return target ?? null;
}

async function findTargetForAutodepositSetup(args: {
  client: YieldOptimizationClient;
  policyAccount: string;
  recurringDelegation: string;
}): Promise<BalanceSweepTargetRecord | null> {
  const byPolicy = await findTargetByPolicy({
    client: args.client,
    policyAccount: args.policyAccount,
  });
  if (byPolicy) {
    return byPolicy;
  }

  return findTargetByRecurringDelegation({
    client: args.client,
    recurringDelegation: args.recurringDelegation,
  });
}

function assertTargetCanResumeAutodepositSetup(
  existing: BalanceSweepTargetRecord,
  input: ConfirmedEarnAutodepositSetupInput
) {
  const mismatches: string[] = [];

  if (existing.settings !== input.settings) {
    mismatches.push("settings");
  }
  if (existing.wallet !== input.walletAddress) {
    mismatches.push("wallet");
  }
  if (existing.vaultIndex !== input.vaultIndex) {
    mismatches.push("vaultIndex");
  }
  if (existing.vaultPubkey !== input.vaultPubkey) {
    mismatches.push("vaultPubkey");
  }
  if (existing.walletUsdcAta !== input.walletUsdcAta) {
    mismatches.push("walletUsdcAta");
  }
  if (existing.vaultUsdcAta !== input.vaultUsdcAta) {
    mismatches.push("vaultUsdcAta");
  }
  if (existing.tokenMint !== input.liquidityMint) {
    mismatches.push("tokenMint");
  }
  if (existing.walletTokenAta !== input.walletUsdcAta) {
    mismatches.push("walletTokenAta");
  }
  if (existing.vaultTokenAta !== input.vaultUsdcAta) {
    mismatches.push("vaultTokenAta");
  }
  if (
    existing.subscriptionAuthority !== null &&
    existing.subscriptionAuthority !== input.subscriptionAuthority
  ) {
    mismatches.push("subscriptionAuthority");
  }
  if (
    existing.recurringDelegation !== null &&
    existing.recurringDelegation !== input.recurringDelegation
  ) {
    mismatches.push("recurringDelegation");
  }
  if (
    existing.recurringDelegationNonce !== undefined &&
    existing.recurringDelegationNonce !== null &&
    existing.recurringDelegationNonce !== input.nonce
  ) {
    mismatches.push("recurringDelegationNonce");
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Existing autodeposit setup target does not match confirmed setup metadata: ${mismatches.join(
        ", "
      )}.`
    );
  }
}

async function markSupersededAutodepositPolicyInactive(args: {
  client: YieldOptimizationClient;
  existing: BalanceSweepTargetRecord;
  input: ConfirmedEarnAutodepositSetupInput;
  now: Date;
}) {
  if (args.existing.policyAccount === args.input.policyAccount) {
    return;
  }

  await args.client.db
    .update(balanceSweepPolicies)
    .set({
      active: false,
      lastSeenAt: args.now,
      lastSeenSignature: args.input.setupSignature,
      lastSeenSlot: args.input.confirmedSlot,
    })
    .where(eq(balanceSweepPolicies.policyAccount, args.existing.policyAccount));
}

function createBootstrapWalletBalanceEventId(targetId: bigint): bigint {
  return -targetId;
}

function addOneHour(date: Date): Date {
  return new Date(date.getTime() + 60 * 60 * 1000);
}

const EARN_AUTODEPOSIT_DELEGATION_READINESS_MARGIN_MS = 0;

export function resolveEarnAutodepositDelegationReadyAt(
  target: Pick<BalanceSweepTargetRecord, "startTimestamp">
): Date | null {
  if (target.startTimestamp === null) {
    return null;
  }

  const startMs = Number(target.startTimestamp * BigInt(1000));
  if (!Number.isFinite(startMs)) {
    return null;
  }

  return new Date(startMs + EARN_AUTODEPOSIT_DELEGATION_READINESS_MARGIN_MS);
}

function maxDate(first: Date, second: Date | null): Date {
  if (!second || first.getTime() >= second.getTime()) {
    return first;
  }
  return second;
}

function resolveEarnAutodepositSweepEligibleAfter(
  target: Pick<BalanceSweepTargetRecord, "startTimestamp">,
  scheduledAt: Date
): Date {
  return maxDate(scheduledAt, resolveEarnAutodepositDelegationReadyAt(target));
}

function toBigIntValue(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" || typeof value === "string") {
    return BigInt(value);
  }
  throw new Error("Expected bigint-compatible database value.");
}

function toDateValue(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  throw new Error("Expected date-compatible database value.");
}

function getExecuteRows(result: unknown): Record<string, unknown>[] {
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }

  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }

  return [];
}

function isOpenScheduledSweep(
  sweep: PendingEarnAutodepositScheduledSweepRecord
): boolean {
  return sweep.status === "scheduled" && sweep.remainingAmountRaw > BigInt(0);
}

async function ensureScheduledAutodepositSlot(
  input: {
    eligibleAfter: Date;
    mint: string;
    targetId: bigint;
  },
  dependencies: Pick<EarnAutodepositRepositoryDependencies, "client" | "now">
): Promise<bigint> {
  const now = dependencies.now();
  const queryResult = await dependencies.client.db.execute(sql`
    WITH existing_slot AS (
      SELECT slot.id
      FROM ${balanceSweepScheduledSlots} AS slot
      WHERE slot.target_id = ${input.targetId}
        AND slot.token_mint = ${input.mint}
        AND slot.status = 'scheduled'
      ORDER BY slot.eligible_after ASC, slot.id ASC
      LIMIT 1
    ),
    updated_slot AS (
      UPDATE ${balanceSweepScheduledSlots} AS slot
      SET eligible_after = GREATEST(slot.eligible_after, ${input.eligibleAfter}),
          updated_at = ${now}
      WHERE slot.id IN (SELECT id FROM existing_slot)
      RETURNING slot.id
    ),
    inserted_slot AS (
      INSERT INTO ${balanceSweepScheduledSlots} (
        target_id,
        token_mint,
        eligible_after,
        status,
        created_at,
        updated_at
      )
      SELECT
        ${input.targetId},
        ${input.mint},
        ${input.eligibleAfter},
        'scheduled',
        ${now},
        ${now}
      WHERE NOT EXISTS (SELECT 1 FROM updated_slot)
      RETURNING id
    )
    SELECT id FROM updated_slot
    UNION ALL
    SELECT id FROM inserted_slot
    LIMIT 1
  `);
  const [row] = getExecuteRows(queryResult);

  if (!row) {
    throw new Error("Failed to create Autodeposit scheduled slot.");
  }

  return toBigIntValue(row.id);
}

async function findScheduledAutodepositSweepBySlotId(
  input: {
    slotId: bigint;
    target: Pick<BalanceSweepTargetRecord, "id" | "startTimestamp">;
  },
  dependencies: Pick<EarnAutodepositRepositoryDependencies, "client">
): Promise<PendingEarnAutodepositScheduledSweepRecord | null> {
  const sweeps = await findPendingEarnAutodepositScheduledSweeps(
    input.target,
    dependencies
  );
  return sweeps.find((sweep) => sweep.slotId === input.slotId) ?? null;
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

// A scheduled sweep only makes sense while the wallet holds surplus above the
// floor to move into Earn. The bootstrap "initial surplus" sweep is snapshotted
// at setup, but that surplus is frequently swept by the recurring delegation (or
// spent) without the scheduled slot ever being reconciled — leaving a stale
// "Execute now" row the worker can never satisfy. Both the web and mobile state
// reads call this to clear those rows server-side once the on-chain surplus is
// gone, matching the clients' display-side surplus cap. Mirror of the 0.01 USDC
// visibility threshold the clients use.
const EARN_AUTODEPOSIT_RECONCILE_MIN_SURPLUS_RAW = BigInt(10_000);

export async function reconcileStaleEarnAutodepositScheduledSweeps(
  args: {
    target: Pick<BalanceSweepTargetRecord, "id" | "walletBalanceFloorRaw">;
    walletTokenBalanceRaw: bigint;
  },
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<{ canceledSlotCount: number; suppressedLotCount: number }> {
  const floorRaw = args.target.walletBalanceFloorRaw ?? BigInt(0);
  // Real surplus still backs the sweeps — leave them for the worker.
  if (
    args.walletTokenBalanceRaw - floorRaw >=
    EARN_AUTODEPOSIT_RECONCILE_MIN_SURPLUS_RAW
  ) {
    return { canceledSlotCount: 0, suppressedLotCount: 0 };
  }
  const { client } = dependencies;
  const now = dependencies.now();

  // Suppress unclaimed surplus lots ('open') — nothing above the floor to sweep,
  // so the scheduled slots they back empty out (remaining → 0) and the sweep
  // worker, which scans open lots, skips them. 'selected'/claimed lots belong to
  // an in-flight execution and are left untouched.
  const suppressed = await client.db.execute(sql`
    UPDATE ${balanceSweepSurplusLots}
    SET status = 'suppressed', updated_at = ${now}
    WHERE ${balanceSweepSurplusLots.targetId} = ${args.target.id}
      AND ${balanceSweepSurplusLots.status} = 'open'
      AND ${balanceSweepSurplusLots.remainingAmountRaw} > 0
    RETURNING ${balanceSweepSurplusLots.id}
  `);

  // Cancel slots the worker is already done with ('failed'/'released'): the
  // pending query returns those by status regardless of remaining amount, so
  // suppressing lots alone won't hide them. 'requested'/'selected' are mid-
  // execution and never touched; 'scheduled' slots drop on their own once their
  // lots are suppressed (and stay reusable for the next real surplus).
  const canceled = await client.db.execute(sql`
    UPDATE ${balanceSweepScheduledSlots}
    SET status = 'canceled',
        last_error = 'reconciled: wallet at or below floor, no surplus to sweep',
        updated_at = ${now}
    WHERE ${balanceSweepScheduledSlots.targetId} = ${args.target.id}
      AND ${balanceSweepScheduledSlots.status} IN ('failed', 'released')
    RETURNING ${balanceSweepScheduledSlots.id}
  `);

  return {
    canceledSlotCount: getExecuteRows(canceled).length,
    suppressedLotCount: getExecuteRows(suppressed).length,
  };
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
    .from(balanceSweepTargets)
    .leftJoin(
      balanceSweepPolicies,
      eq(balanceSweepTargets.balanceSweepPolicyId, balanceSweepPolicies.id)
    )
    .where(
      and(
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

/**
 * True when the wallet has ANY non-closed autodeposit target, across all
 * settings (duplicate/poisoned rows included). Gates the stray-approval
 * revoke rider: the SPL delegate is load-bearing for sweeps while any target
 * is live, so the rider must stay off unless every row is closed.
 */
export async function hasLiveBalanceSweepTargetForWallet(
  walletAddress: string,
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<boolean> {
  const [row] = await dependencies.client.db
    .select({ id: balanceSweepTargets.id })
    .from(balanceSweepTargets)
    .where(
      and(
        eq(balanceSweepTargets.wallet, walletAddress),
        ne(balanceSweepTargets.lifecycleStatus, "closed")
      )
    )
    .limit(1);
  return Boolean(row);
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
  target: Pick<BalanceSweepTargetRecord, "id" | "startTimestamp">,
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<PendingEarnAutodepositScheduledSweepRecord[]> {
  const queryResult = await dependencies.client.db.execute(sql`
    WITH slot_lots AS (
      SELECT
        slot.id AS slot_id,
        slot.eligible_after,
        slot.status::text AS slot_status,
        lot.classification::text AS classification,
        lot.confidence,
        lot.reason,
        lot.original_amount_raw,
        lot.remaining_amount_raw,
        lot.status::text AS lot_status,
        lot.created_at,
        claim.amount_raw AS claim_amount_raw
      FROM ${balanceSweepScheduledSlots} AS slot
      LEFT JOIN ${balanceSweepSurplusLots} AS lot
        ON lot.scheduled_slot_id = slot.id
      LEFT JOIN ${balanceSweepLotClaims} AS claim
        ON claim.claim_token = slot.claim_token
       AND claim.status = 'selected'
      WHERE slot.target_id = ${target.id}
        AND slot.status IN ('scheduled', 'requested', 'selected', 'failed', 'released')
    ),
    aggregated AS (
      SELECT
        slot_id,
        MIN(eligible_after) AS eligible_after,
        MIN(classification) FILTER (WHERE lot_status = 'open') AS classification,
        MIN(confidence) FILTER (WHERE lot_status = 'open') AS confidence,
        MIN(reason) FILTER (WHERE lot_status = 'open') AS reason,
        SUM(original_amount_raw) FILTER (WHERE lot_status = 'open') AS original_amount_raw,
        SUM(remaining_amount_raw) FILTER (WHERE lot_status = 'open') AS remaining_amount_raw,
        MAX(claim_amount_raw) AS claim_amount_raw,
        COUNT(*) FILTER (WHERE lot_status = 'open' AND remaining_amount_raw > 0) AS lot_count,
        MIN(created_at) FILTER (WHERE lot_status = 'open') AS first_lot_created_at,
        MIN(slot_status) AS status
      FROM slot_lots
      GROUP BY slot_id
    )
    SELECT
      aggregated.slot_id AS "slotId",
      aggregated.slot_id AS id,
      COALESCE(aggregated.classification, 'unknown') AS classification,
      COALESCE(aggregated.confidence, 'unknown') AS confidence,
      aggregated.eligible_after AS "eligibleAfter",
      COALESCE(aggregated.lot_count, 0)::bigint AS "lotCount",
      COALESCE(aggregated.original_amount_raw, aggregated.claim_amount_raw, 0)::bigint AS "originalAmountRaw",
      COALESCE(aggregated.reason, 'Autodeposit scheduled sweep') AS reason,
      COALESCE(aggregated.remaining_amount_raw, aggregated.claim_amount_raw, 0)::bigint AS "remainingAmountRaw",
      aggregated.status AS status
    FROM aggregated
    WHERE COALESCE(aggregated.remaining_amount_raw, aggregated.claim_amount_raw, 0) > 0
       OR aggregated.status IN ('requested', 'selected', 'failed', 'released')
    ORDER BY aggregated.eligible_after ASC, aggregated.first_lot_created_at ASC NULLS LAST, aggregated.slot_id ASC
  `);

  const executeNowAvailableAt = resolveEarnAutodepositDelegationReadyAt(target);

  return getExecuteRows(queryResult).map((row) => ({
    classification: String(row.classification),
    confidence: String(row.confidence),
    eligibleAfter: toDateValue(row.eligibleAfter),
    executeNowAvailableAt,
    id: toBigIntValue(row.id),
    lotCount: Number(toBigIntValue(row.lotCount)),
    originalAmountRaw: toBigIntValue(row.originalAmountRaw),
    reason: String(row.reason),
    remainingAmountRaw: toBigIntValue(row.remainingAmountRaw),
    slotId: toBigIntValue(row.slotId),
    status: String(row.status),
  }));
}

export async function findEarnAutodepositScheduledSweepProgress(
  target: Pick<BalanceSweepTargetRecord, "id">,
  slotId: bigint,
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<EarnAutodepositScheduledSweepProgressRecord | null> {
  const queryResult = await dependencies.client.db.execute(sql`
    SELECT
      slot.id AS "slotId",
      slot.status::text AS status,
      execution.completed_at AS "completedAt",
      execution.completion_failure_code AS "completionFailureCode",
      latest_event.id AS "eventId",
      COALESCE(latest_event.created_at, slot.updated_at) AS "occurredAt"
    FROM ${balanceSweepScheduledSlots} AS slot
    LEFT JOIN loyal_yield.balance_sweep_executions AS execution
      ON execution.id = slot.execution_id
    LEFT JOIN LATERAL (
      SELECT event.id, event.created_at
      FROM loyal_yield.realtime_events AS event
      WHERE event.scheduled_slot_id = slot.id
        AND event.scope = 'autodeposit'
      ORDER BY event.id DESC
      LIMIT 1
    ) AS latest_event ON true
    WHERE slot.target_id = ${target.id}
      AND slot.id = ${slotId}
    LIMIT 1
  `);
  const [row] = getExecuteRows(queryResult);
  if (!row) {
    return null;
  }

  return {
    completedAt:
      row.completedAt === null || row.completedAt === undefined
        ? null
        : toDateValue(row.completedAt),
    completionFailureCode:
      typeof row.completionFailureCode === "string"
        ? row.completionFailureCode
        : null,
    eventId:
      row.eventId === null || row.eventId === undefined
        ? null
        : toBigIntValue(row.eventId),
    occurredAt: toDateValue(row.occurredAt),
    slotId: toBigIntValue(row.slotId),
    status: String(row.status),
  };
}

export async function requestImmediateEarnAutodepositScheduledSweep(
  state: CurrentEarnAutodepositState,
  options: ImmediateEarnAutodepositScheduledSweepRequestOptions = {},
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<ImmediateEarnAutodepositScheduledSweepRequestResult | null> {
  if (state.status !== "active") {
    throw new Error("Autodeposit target is not active.");
  }

  const now = dependencies.now();
  const executeNowEligibleAfter = maxDate(
    now,
    resolveEarnAutodepositDelegationReadyAt(state.target)
  );
  const queryResult = await dependencies.client.db.execute(sql`
    WITH selected_slot AS (
      SELECT slot.id
      FROM ${balanceSweepScheduledSlots} AS slot
      WHERE slot.target_id = ${state.target.id}
        AND (${options.slotId ?? null}::bigint IS NULL OR slot.id = ${
    options.slotId ?? null
  })
        AND slot.status IN ('scheduled', 'failed', 'released')
        AND EXISTS (
          SELECT 1
          FROM ${balanceSweepSurplusLots} AS lot
          WHERE lot.scheduled_slot_id = slot.id
            AND lot.status = 'open'
            AND lot.remaining_amount_raw > 0
        )
      ORDER BY slot.eligible_after ASC, slot.id ASC
      LIMIT 1
      FOR UPDATE
    ),
    updated_slot AS (
      UPDATE ${balanceSweepScheduledSlots} AS slot
      SET status = 'requested',
          request_source = 'web_execute_now',
          requested_at = ${now},
          eligible_after = ${executeNowEligibleAfter},
          last_error = NULL,
          updated_at = ${now}
      WHERE slot.id IN (SELECT id FROM selected_slot)
      RETURNING slot.id, slot.eligible_after, slot.status::text AS status
    ),
    updated_lots AS (
      UPDATE ${balanceSweepSurplusLots} AS lot
      SET confidence = 'user_requested',
          eligible_after = ${executeNowEligibleAfter},
          reason = CASE
            WHEN lot.reason LIKE 'user requested immediate autodeposit sweep;%'
              THEN lot.reason
            ELSE concat('user requested immediate autodeposit sweep; ', lot.reason)
          END,
          updated_at = ${now}
      WHERE lot.scheduled_slot_id IN (SELECT id FROM updated_slot)
        AND lot.status = 'open'
        AND lot.remaining_amount_raw > 0
      RETURNING lot.remaining_amount_raw
    )
    SELECT
      updated_slot.id AS "slotId",
      updated_slot.eligible_after AS "eligibleAfter",
      updated_slot.status AS status,
      COALESCE(SUM(updated_lots.remaining_amount_raw), 0)::bigint AS "acceleratedAmountRaw",
      COUNT(updated_lots.remaining_amount_raw)::bigint AS "acceleratedLotCount"
    FROM updated_slot
    LEFT JOIN updated_lots ON true
    GROUP BY updated_slot.id, updated_slot.eligible_after, updated_slot.status
  `);
  const [row] = getExecuteRows(queryResult);

  if (!row) {
    return null;
  }

  return {
    acceleratedAmountRaw: toBigIntValue(row.acceleratedAmountRaw),
    acceleratedLotCount: Number(toBigIntValue(row.acceleratedLotCount)),
    eligibleAfter: toDateValue(row.eligibleAfter),
    slotId: toBigIntValue(row.slotId),
    status: String(row.status),
    targetId: state.target.id,
  };
}

export async function scheduleBootstrapEarnAutodepositSweep(
  input: {
    snapshot: EarnAutodepositBootstrapWalletBalanceSnapshot;
    target: BalanceSweepTargetRecord;
  },
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<EarnAutodepositBootstrapSweepResult> {
  const { client } = dependencies;
  const now = dependencies.now();
  const { snapshot, target } = input;
  const existingProjection = await client.db
    .select()
    .from(balanceSweepWalletBalancesCurrent)
    .where(
      and(
        eq(balanceSweepWalletBalancesCurrent.targetId, target.id),
        eq(balanceSweepWalletBalancesCurrent.mint, snapshot.mint)
      )
    )
    .limit(1);

  await upsertBalanceSweepWalletBalanceCurrent(
    {
      accountDataHash: snapshot.accountDataHash,
      amountRaw: snapshot.amountRaw,
      mint: snapshot.mint,
      observedAt: snapshot.observedAt,
      observedSlot: snapshot.observedSlot,
      owner: snapshot.owner,
      rawEvidence: snapshot.rawEvidence ?? null,
      source: snapshot.source,
      sourceCommitment: snapshot.sourceCommitment,
      targetId: target.id,
      wallet: target.wallet,
      walletTokenAta: target.walletTokenAta,
      walletUsdcAta: target.walletUsdcAta,
    },
    dependencies
  );

  const floorRaw = target.walletBalanceFloorRaw ?? BigInt(0);
  if (snapshot.amountRaw <= floorRaw) {
    return {
      reason: "wallet_balance_at_or_below_floor",
      status: "skipped",
    };
  }

  const sourceEventId = createBootstrapWalletBalanceEventId(target.id);
  const previousAmountRaw = existingProjection[0]?.amountRaw ?? null;
  const surplusRaw = snapshot.amountRaw - floorRaw;

  await client.db
    .insert(balanceSweepWalletBalanceEvents)
    .values({
      accountDataHash: snapshot.accountDataHash,
      amountRaw: snapshot.amountRaw,
      deltaAmountRaw:
        previousAmountRaw === null
          ? null
          : snapshot.amountRaw - previousAmountRaw,
      eventId: sourceEventId,
      mint: snapshot.mint,
      observedAt: snapshot.observedAt,
      observedSlot: snapshot.observedSlot,
      previousAmountRaw,
      projectedAt: now,
      rawEvidence: {
        ...(snapshot.rawEvidence ?? {}),
        bootstrap: true,
        setupSignature: target.lastSeenSignature,
      },
      source: snapshot.source,
      sourceCommitment: snapshot.sourceCommitment,
      targetId: target.id,
      txnSignature: null,
      wallet: target.wallet,
      walletTokenAta: target.walletTokenAta,
      walletUsdcAta: target.walletUsdcAta,
    })
    .onConflictDoNothing({
      target: [balanceSweepWalletBalanceEvents.eventId],
    });

  const [existingLot] = await client.db
    .select({
      id: balanceSweepSurplusLots.id,
      remainingAmountRaw: balanceSweepSurplusLots.remainingAmountRaw,
      scheduledSlotId: balanceSweepSurplusLots.scheduledSlotId,
      status: balanceSweepSurplusLots.status,
    })
    .from(balanceSweepSurplusLots)
    .where(eq(balanceSweepSurplusLots.sourceEventId, sourceEventId))
    .limit(1);

  if (existingLot && existingLot.status === "open") {
    let slotId = existingLot.scheduledSlotId;
    if (!slotId) {
      slotId = await ensureScheduledAutodepositSlot(
        {
          eligibleAfter: resolveEarnAutodepositSweepEligibleAfter(
            target,
            addOneHour(snapshot.observedAt)
          ),
          mint: snapshot.mint,
          targetId: target.id,
        },
        dependencies
      );
      await client.db
        .update(balanceSweepSurplusLots)
        .set({
          scheduledSlotId: slotId,
          updatedAt: now,
        })
        .where(eq(balanceSweepSurplusLots.id, existingLot.id));
    }

    const sweep = await findScheduledAutodepositSweepBySlotId(
      { slotId, target },
      dependencies
    );
    if (sweep && isOpenScheduledSweep(sweep)) {
      return {
        status: "already_exists",
        sweep,
      };
    }
  }
  if (existingLot) {
    return {
      reason: "bootstrap_sweep_already_closed",
      status: "skipped",
    };
  }

  const eligibleAfter = resolveEarnAutodepositSweepEligibleAfter(
    target,
    addOneHour(snapshot.observedAt)
  );
  const slotId = await ensureScheduledAutodepositSlot(
    {
      eligibleAfter,
      mint: snapshot.mint,
      targetId: target.id,
    },
    dependencies
  );

  const insertedLots = await client.db
    .insert(balanceSweepSurplusLots)
    .values({
      classification: "initial_surplus",
      confidence: "confirmed_snapshot",
      createdAt: now,
      eligibleAfter,
      originalAmountRaw: surplusRaw,
      reason: "initial Autodeposit surplus detected at setup confirmation",
      remainingAmountRaw: surplusRaw,
      scheduledSlotId: slotId,
      sourceEventId,
      sourceSignature: null,
      status: "open",
      targetId: target.id,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [balanceSweepSurplusLots.sourceEventId],
    })
    .returning({
      id: balanceSweepSurplusLots.id,
      scheduledSlotId: balanceSweepSurplusLots.scheduledSlotId,
    });

  if (insertedLots[0]) {
    const sweep = await findScheduledAutodepositSweepBySlotId(
      { slotId, target },
      dependencies
    );
    if (sweep) {
      return {
        status: "scheduled",
        sweep,
      };
    }
  }

  const [raceWinnerLot] = await client.db
    .select({
      id: balanceSweepSurplusLots.id,
      scheduledSlotId: balanceSweepSurplusLots.scheduledSlotId,
      status: balanceSweepSurplusLots.status,
    })
    .from(balanceSweepSurplusLots)
    .where(eq(balanceSweepSurplusLots.sourceEventId, sourceEventId))
    .limit(1);

  if (raceWinnerLot?.status === "open") {
    const raceWinnerSlotId = raceWinnerLot.scheduledSlotId ?? slotId;
    if (!raceWinnerLot.scheduledSlotId) {
      await client.db
        .update(balanceSweepSurplusLots)
        .set({
          scheduledSlotId: raceWinnerSlotId,
          updatedAt: now,
        })
        .where(eq(balanceSweepSurplusLots.id, raceWinnerLot.id));
    }
    const sweep = await findScheduledAutodepositSweepBySlotId(
      { slotId: raceWinnerSlotId, target },
      dependencies
    );
    if (sweep && isOpenScheduledSweep(sweep)) {
      return {
        status: "already_exists",
        sweep,
      };
    }
  }

  return {
    reason: "bootstrap_sweep_already_closed",
    status: "skipped",
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

// The sweep worker's notify payload only carries the wallet address; the
// execution row it just recorded carries the amount. Callers should treat a
// stale `recordedAt` as "no amount" rather than attribute an old sweep.
export async function findLatestEarnAutodepositExecutionForWallet(
  walletAddress: string,
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<{ amountRaw: bigint; recordedAt: Date } | null> {
  const rows = await dependencies.client.db
    .select({
      amountRaw: balanceSweepExecutions.amountRaw,
      decodedAt: balanceSweepExecutions.decodedAt,
      receivedAt: balanceSweepExecutions.receivedAt,
    })
    .from(balanceSweepExecutions)
    .innerJoin(
      balanceSweepTargets,
      eq(balanceSweepExecutions.targetId, balanceSweepTargets.id)
    )
    .where(eq(balanceSweepTargets.wallet, walletAddress))
    .orderBy(desc(balanceSweepExecutions.id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    amountRaw: row.amountRaw,
    recordedAt: row.decodedAt ?? row.receivedAt,
  };
}

function targetValuesFromSetup(
  input: ConfirmedEarnAutodepositSetupInput,
  balanceSweepPolicyId: bigint | null,
  now: Date,
  active: boolean,
  lifecycleStatus: "active" | "pending_delegation" | "pending_policy"
) {
  return {
    active,
    authority: input.walletAddress,
    balanceSweepPolicyId,
    closeSignature: null,
    closeSlot: null,
    closedAt: null,
    cluster: input.cluster,
    delegatedSigners: [input.delegatedSigner],
    firstSeenAt: now,
    lastSeenAt: now,
    lastSeenSignature: input.setupSignature,
    lastSeenSlot: input.confirmedSlot,
    lifecycleStatus,
    maxAmountPerPeriod: input.amountPerPeriodRaw,
    periodLengthSeconds: input.periodLengthSeconds,
    policyConfirmedSlot:
      input.setupStage === "create_policy" ? input.confirmedSlot : null,
    policyAccount: input.policyAccount,
    policySeed: input.policySeed,
    policySignature:
      input.setupStage === "create_policy" ? input.setupSignature : null,
    recurringDelegation: input.recurringDelegation,
    recurringDelegationConfirmedSlot:
      input.setupStage === "create_recurring_delegation"
        ? input.confirmedSlot
        : null,
    recurringDelegationExpiryTimestamp: input.expiryTimestamp,
    recurringDelegationNonce: input.nonce,
    recurringDelegationSignature:
      input.setupStage === "create_recurring_delegation"
        ? input.setupSignature
        : null,
    settings: input.settings,
    startTimestamp: input.startTimestamp,
    subscriptionAuthority: input.subscriptionAuthority,
    threshold: 1,
    tokenMint: input.liquidityMint,
    vaultIndex: input.vaultIndex,
    vaultTokenAta: input.vaultUsdcAta,
    vaultPubkey: input.vaultPubkey,
    vaultUsdcAta: input.vaultUsdcAta,
    wallet: input.walletAddress,
    walletBalanceFloorRaw: input.walletBalanceFloorRaw,
    walletTokenAta: input.walletUsdcAta,
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

function isAutodepositSetupStageAlreadyRecorded(
  existing: BalanceSweepTargetRecord | null,
  input: ConfirmedEarnAutodepositSetupInput
): boolean {
  if (!existing) {
    return false;
  }

  if (input.setupStage === "create_policy") {
    return (
      existing.policyConfirmedSlot !== undefined &&
      existing.policyConfirmedSlot !== null &&
      existing.policyConfirmedSlot >= input.confirmedSlot
    );
  }

  if (input.setupStage === "create_recurring_delegation") {
    return (
      existing.recurringDelegationConfirmedSlot !== undefined &&
      existing.recurringDelegationConfirmedSlot !== null &&
      existing.recurringDelegationConfirmedSlot >= input.confirmedSlot
    );
  }

  return false;
}

function resolveMergedAutodepositLifecycle(args: {
  existing: BalanceSweepTargetRecord | null;
  input: ConfirmedEarnAutodepositSetupInput;
}): {
  active: boolean;
  lifecycleStatus: "active" | "pending_delegation" | "pending_policy";
} {
  const hasPolicy =
    args.input.setupStage === "create_policy" ||
    (args.existing ? hasRecordedAutodepositPolicy(args.existing) : false);
  const hasDelegation =
    args.input.setupStage === "create_recurring_delegation" ||
    (args.existing ? hasRecordedAutodepositDelegation(args.existing) : false);

  if (hasPolicy && hasDelegation) {
    return { active: true, lifecycleStatus: "active" };
  }
  if (hasPolicy) {
    return { active: false, lifecycleStatus: "pending_delegation" };
  }
  return { active: false, lifecycleStatus: "pending_policy" };
}

function resolveMergedLastSeen(args: {
  existing: BalanceSweepTargetRecord | null;
  input: ConfirmedEarnAutodepositSetupInput;
}): { lastSeenSignature: string; lastSeenSlot: bigint } {
  if (
    !args.existing ||
    args.input.confirmedSlot >= args.existing.lastSeenSlot
  ) {
    return {
      lastSeenSignature: args.input.setupSignature,
      lastSeenSlot: args.input.confirmedSlot,
    };
  }

  return {
    lastSeenSignature: args.existing.lastSeenSignature,
    lastSeenSlot: args.existing.lastSeenSlot,
  };
}

function mergedTargetActiveSql() {
  return sql`COALESCE(${balanceSweepTargets.policySignature}, excluded.policy_signature) IS NOT NULL
    AND COALESCE(${balanceSweepTargets.policyConfirmedSlot}, excluded.policy_confirmed_slot) IS NOT NULL
    AND COALESCE(${balanceSweepTargets.recurringDelegationSignature}, excluded.recurring_delegation_signature) IS NOT NULL
    AND COALESCE(${balanceSweepTargets.recurringDelegationConfirmedSlot}, excluded.recurring_delegation_confirmed_slot) IS NOT NULL`;
}

function mergedTargetLifecycleStatusSql() {
  return sql`CASE
    WHEN ${mergedTargetActiveSql()} THEN 'active'
    WHEN COALESCE(${
      balanceSweepTargets.policySignature
    }, excluded.policy_signature) IS NOT NULL
      AND COALESCE(${
        balanceSweepTargets.policyConfirmedSlot
      }, excluded.policy_confirmed_slot) IS NOT NULL
      THEN 'pending_delegation'
    ELSE 'pending_policy'
  END`;
}

async function recordAutodepositSetupConfirmation(
  input: ConfirmedEarnAutodepositSetupInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  assertSetupHasPolicy(input);
  if (
    input.setupStage !== "create_policy" &&
    input.setupStage !== "create_recurring_delegation"
  ) {
    throw new Error("Autodeposit setup confirmation must be a setup stage.");
  }

  const { client } = dependencies;
  const now = dependencies.now();
  const existing = await findTargetForAutodepositSetup({
    client,
    policyAccount: input.policyAccount,
    recurringDelegation: input.recurringDelegation,
  });
  if (existing) {
    assertTargetCanResumeAutodepositSetup(existing, input);
  }
  const closedTarget = assertClosedTargetCanReceiveSetup(
    existing,
    input.confirmedSlot
  );
  if (closedTarget) {
    return closedTarget;
  }

  if (existing && isAutodepositSetupStageAlreadyRecorded(existing, input)) {
    return existing;
  }

  const policy =
    input.setupStage === "create_policy"
      ? await upsertBalanceSweepPolicyFromSetup({
          client,
          input,
          now,
        })
      : null;
  const merged = resolveMergedAutodepositLifecycle({ existing, input });
  const lastSeen = resolveMergedLastSeen({ existing, input });
  const values = targetValuesFromSetup(
    input,
    policy?.id ?? null,
    now,
    merged.active,
    merged.lifecycleStatus
  );
  if (existing) {
    const [target] = await client.db
      .update(balanceSweepTargets)
      .set({
        active: merged.active,
        balanceSweepPolicyId:
          policy?.id ?? existing.balanceSweepPolicyId ?? null,
        cluster: input.cluster,
        closeSignature: null,
        closeSlot: null,
        closedAt: null,
        delegatedSigners: [input.delegatedSigner],
        lastSeenAt: now,
        lastSeenSignature: lastSeen.lastSeenSignature,
        lastSeenSlot: lastSeen.lastSeenSlot,
        lifecycleStatus: merged.lifecycleStatus,
        maxAmountPerPeriod: input.amountPerPeriodRaw,
        periodLengthSeconds: input.periodLengthSeconds,
        policyAccount: input.policyAccount,
        policyConfirmedSlot:
          input.setupStage === "create_policy"
            ? input.confirmedSlot
            : existing.policyConfirmedSlot ?? null,
        policySeed: input.policySeed,
        policySignature:
          input.setupStage === "create_policy"
            ? input.setupSignature
            : existing.policySignature ?? null,
        recurringDelegation: input.recurringDelegation,
        recurringDelegationConfirmedSlot:
          input.setupStage === "create_recurring_delegation"
            ? input.confirmedSlot
            : existing.recurringDelegationConfirmedSlot ?? null,
        recurringDelegationExpiryTimestamp: input.expiryTimestamp,
        recurringDelegationNonce: input.nonce,
        recurringDelegationSignature:
          input.setupStage === "create_recurring_delegation"
            ? input.setupSignature
            : existing.recurringDelegationSignature ?? null,
        startTimestamp: input.startTimestamp,
        subscriptionAuthority: input.subscriptionAuthority,
        tokenMint: input.liquidityMint,
        vaultPubkey: input.vaultPubkey,
        vaultTokenAta: input.vaultUsdcAta,
        vaultUsdcAta: input.vaultUsdcAta,
        walletBalanceFloorRaw: input.walletBalanceFloorRaw,
        walletTokenAta: input.walletUsdcAta,
        walletUsdcAta: input.walletUsdcAta,
      })
      .where(eq(balanceSweepTargets.id, existing.id))
      .returning();

    if (!target) {
      throw new Error("Failed to merge confirmed autodeposit setup.");
    }

    await markSupersededAutodepositPolicyInactive({
      client,
      existing,
      input,
      now,
    });

    return target;
  }

  const [target] = await client.db
    .insert(balanceSweepTargets)
    .values(values)
    .onConflictDoUpdate({
      target: [balanceSweepTargets.policyAccount],
      set: {
        active: mergedTargetActiveSql(),
        balanceSweepPolicyId:
          policy?.id ??
          sql`COALESCE(${balanceSweepTargets.balanceSweepPolicyId}, excluded.balance_sweep_policy_id)`,
        cluster: input.cluster,
        closeSignature: null,
        closeSlot: null,
        closedAt: null,
        delegatedSigners: sql`excluded.delegated_signers`,
        lastSeenAt: now,
        lastSeenSignature: sql`CASE
          WHEN excluded.last_seen_slot >= ${balanceSweepTargets.lastSeenSlot}
            THEN excluded.last_seen_signature
          ELSE ${balanceSweepTargets.lastSeenSignature}
        END`,
        lastSeenSlot: sql`GREATEST(${balanceSweepTargets.lastSeenSlot}, excluded.last_seen_slot)`,
        lifecycleStatus: mergedTargetLifecycleStatusSql(),
        maxAmountPerPeriod: input.amountPerPeriodRaw,
        periodLengthSeconds: input.periodLengthSeconds,
        policyConfirmedSlot:
          input.setupStage === "create_policy"
            ? input.confirmedSlot
            : sql`COALESCE(${balanceSweepTargets.policyConfirmedSlot}, excluded.policy_confirmed_slot)`,
        policySignature:
          input.setupStage === "create_policy"
            ? input.setupSignature
            : sql`COALESCE(${balanceSweepTargets.policySignature}, excluded.policy_signature)`,
        recurringDelegation: input.recurringDelegation,
        recurringDelegationConfirmedSlot:
          input.setupStage === "create_recurring_delegation"
            ? input.confirmedSlot
            : sql`COALESCE(${balanceSweepTargets.recurringDelegationConfirmedSlot}, excluded.recurring_delegation_confirmed_slot)`,
        recurringDelegationExpiryTimestamp: input.expiryTimestamp,
        recurringDelegationNonce: input.nonce,
        recurringDelegationSignature:
          input.setupStage === "create_recurring_delegation"
            ? input.setupSignature
            : sql`COALESCE(${balanceSweepTargets.recurringDelegationSignature}, excluded.recurring_delegation_signature)`,
        startTimestamp: input.startTimestamp,
        subscriptionAuthority: input.subscriptionAuthority,
        tokenMint: input.liquidityMint,
        vaultPubkey: input.vaultPubkey,
        vaultTokenAta: input.vaultUsdcAta,
        vaultUsdcAta: input.vaultUsdcAta,
        walletBalanceFloorRaw: input.walletBalanceFloorRaw,
        walletTokenAta: input.walletUsdcAta,
        walletUsdcAta: input.walletUsdcAta,
      },
    })
    .returning();

  if (!target) {
    throw new Error("Failed to record confirmed autodeposit setup.");
  }

  return target;
}

export async function recordPendingAutodepositSetup(
  input: ConfirmedEarnAutodepositSetupInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  if (input.setupStage !== "create_policy") {
    throw new Error("Pending setup confirmations must create the policy.");
  }

  return recordAutodepositSetupConfirmation(input, dependencies);
}

export async function recordConfirmedAutodepositDelegation(
  input: ConfirmedEarnAutodepositSetupInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  if (input.setupStage !== "create_recurring_delegation") {
    throw new Error("Autodeposit activation requires recurring delegation.");
  }

  return recordAutodepositSetupConfirmation(input, dependencies);
}

export async function recordConfirmedAutodepositTokenApproval(
  input: ConfirmedEarnAutodepositSetupInput,
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<BalanceSweepTargetRecord> {
  if (input.setupStage !== "approve_token_delegate") {
    throw new Error(
      "Autodeposit token approval repair requires approval stage."
    );
  }

  const { client } = dependencies;
  const now = dependencies.now();
  const existing = await findTargetForAutodepositSetup({
    client,
    policyAccount: input.policyAccount,
    recurringDelegation: input.recurringDelegation,
  });
  if (!existing) {
    throw new Error("Autodeposit target does not exist for approval repair.");
  }
  assertTargetCanResumeAutodepositSetup(existing, input);
  if (!hasRecordedAutodepositPolicy(existing)) {
    throw new Error("Autodeposit approval repair requires a recorded policy.");
  }
  if (!hasRecordedAutodepositDelegation(existing)) {
    throw new Error(
      "Autodeposit approval repair requires a recorded recurring delegation."
    );
  }

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: true,
      cluster: input.cluster,
      closeSignature: null,
      closeSlot: null,
      closedAt: null,
      delegatedSigners: [input.delegatedSigner],
      lastSeenAt: now,
      lastSeenSignature: input.setupSignature,
      lastSeenSlot: input.confirmedSlot,
      lifecycleStatus: "active",
      maxAmountPerPeriod: input.amountPerPeriodRaw,
      periodLengthSeconds: input.periodLengthSeconds,
      recurringDelegationExpiryTimestamp: input.expiryTimestamp,
      recurringDelegationNonce: input.nonce,
      startTimestamp: input.startTimestamp,
      subscriptionAuthority: input.subscriptionAuthority,
      tokenMint: input.liquidityMint,
      vaultPubkey: input.vaultPubkey,
      vaultTokenAta: input.vaultUsdcAta,
      vaultUsdcAta: input.vaultUsdcAta,
      walletBalanceFloorRaw: input.walletBalanceFloorRaw,
      walletTokenAta: input.walletUsdcAta,
      walletUsdcAta: input.walletUsdcAta,
    })
    .where(eq(balanceSweepTargets.id, existing.id))
    .returning();

  if (!target) {
    throw new Error("Failed to record autodeposit approval repair.");
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

export async function reconcileMissingOnChainEarnAutodepositPolicy(
  input: {
    policyAccount: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
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
    existing.vaultIndex !== input.vaultIndex
  ) {
    throw new Error("Autodeposit target does not match the wallet.");
  }

  await cancelScheduledAutodepositTransactionsForClose({
    client,
    now,
    targetId: existing.id,
  });

  if (existing.lifecycleStatus === "closed") {
    return existing;
  }

  const reconciliationSignature = `reconciled_missing_policy:${input.policyAccount}`;

  await client.db
    .update(balanceSweepPolicies)
    .set({
      active: false,
      closeSignature: reconciliationSignature,
      closedAt: now,
      lastSeenAt: now,
      lastSeenSignature: reconciliationSignature,
    })
    .where(eq(balanceSweepPolicies.policyAccount, input.policyAccount));

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: false,
      closeSignature: reconciliationSignature,
      closedAt: now,
      lastSeenAt: now,
      lastSeenSignature: reconciliationSignature,
      lifecycleStatus: "closed",
    })
    .where(eq(balanceSweepTargets.policyAccount, input.policyAccount))
    .returning();

  if (!target) {
    throw new Error("Failed to reconcile missing autodeposit policy.");
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
  dependencies: Pick<EarnAutodepositRepositoryDependencies, "client"> &
    Partial<
      Pick<EarnAutodepositRepositoryDependencies, "now">
    > = createDependencies()
): Promise<EarnAutodepositWalletBalanceFloorUpdateResult> {
  if (input.walletBalanceFloorRaw < BigInt(0)) {
    throw new Error("Autodeposit wallet balance floor cannot be negative.");
  }

  const { client } = dependencies;
  const now = dependencies.now?.() ?? new Date();
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
  if (!existing.active || existing.lifecycleStatus !== "active") {
    throw new Error("Pending autodeposit targets cannot be updated.");
  }
  if (
    !existing.recurringDelegation ||
    existing.recurringDelegation !== input.recurringDelegation
  ) {
    throw new Error("Autodeposit recurring delegation does not match target.");
  }

  const rebaselineEligibleAfter = resolveEarnAutodepositSweepEligibleAfter(
    existing,
    addOneHour(now)
  );

  const queryResult = await client.db.execute(sql`
    WITH locked_target AS (
      SELECT ${balanceSweepTargets.id}
      FROM ${balanceSweepTargets}
      WHERE ${balanceSweepTargets.id} = ${existing.id}
        AND ${balanceSweepTargets.policyAccount} = ${input.policyAccount}
        AND ${balanceSweepTargets.settings} = ${input.settings}
        AND ${balanceSweepTargets.wallet} = ${input.walletAddress}
        AND ${balanceSweepTargets.vaultIndex} = ${input.vaultIndex}
        AND ${balanceSweepTargets.active} = true
        AND ${balanceSweepTargets.lifecycleStatus} = 'active'
        AND ${balanceSweepTargets.recurringDelegation} = ${
    input.recurringDelegation
  }
      FOR UPDATE
    ),
    updated_target AS (
      UPDATE ${balanceSweepTargets}
      SET wallet_balance_floor_raw = ${input.walletBalanceFloorRaw}
      WHERE ${balanceSweepTargets.id} IN (SELECT id FROM locked_target)
      RETURNING
        ${balanceSweepTargets.id},
        ${balanceSweepTargets.wallet},
        ${balanceSweepTargets.walletTokenAta},
        ${balanceSweepTargets.walletUsdcAta}
    ),
    suppressed_lots AS (
      UPDATE ${balanceSweepSurplusLots}
      SET
        status = 'suppressed'::loyal_yield.balance_sweep_surplus_lot_status,
        updated_at = ${now}
      WHERE ${
        balanceSweepSurplusLots.targetId
      } IN (SELECT id FROM updated_target)
        AND ${
          balanceSweepSurplusLots.status
        } = 'open'::loyal_yield.balance_sweep_surplus_lot_status
        AND ${balanceSweepSurplusLots.remainingAmountRaw} > 0
      RETURNING ${balanceSweepSurplusLots.id}
    ),
    projection AS (
      SELECT current_balance.*
      FROM ${balanceSweepWalletBalancesCurrent} current_balance
      INNER JOIN updated_target
        ON updated_target.id = current_balance.target_id
    ),
    inserted_event AS (
      INSERT INTO ${balanceSweepWalletBalanceEvents} (
        event_id,
        target_id,
        wallet,
        wallet_usdc_ata,
        wallet_token_ata,
        mint,
        previous_amount_raw,
        amount_raw,
        delta_amount_raw,
        observed_slot,
        observed_at,
        source,
        source_commitment,
        txn_signature,
        account_data_hash,
        raw_evidence,
        projected_at
      )
      SELECT
        nextval('loyal_yield.balance_sweep_floor_rebaseline_event_id_seq'::regclass)::bigint,
        projection.target_id,
        projection.wallet,
        projection.wallet_usdc_ata,
        projection.wallet_token_ata,
        projection.mint,
        projection.amount_raw,
        projection.amount_raw,
        0,
        projection.observed_slot,
        projection.observed_at,
        'app_autodeposit_floor_rebaseline',
        projection.source_commitment,
        NULL,
        projection.account_data_hash,
        jsonb_build_object(
          'floorRebaseline', true,
          'previousWalletBalanceFloorRaw', ${
            existing.walletBalanceFloorRaw?.toString() ?? null
          }::text,
          'walletBalanceFloorRaw', ${input.walletBalanceFloorRaw.toString()}::text,
          'suppressedOpenLotCount', (SELECT COUNT(*) FROM suppressed_lots)
        ),
        ${now}
      FROM projection
      WHERE projection.amount_raw > ${input.walletBalanceFloorRaw}
      RETURNING event_id
    ),
    candidate_slot AS (
      SELECT slot.id
      FROM ${balanceSweepScheduledSlots} AS slot
      INNER JOIN projection
        ON projection.target_id = slot.target_id
      CROSS JOIN inserted_event
      WHERE slot.token_mint = projection.mint
        AND slot.status = 'scheduled'
      ORDER BY slot.eligible_after ASC, slot.id ASC
      LIMIT 1
    ),
    updated_slot AS (
      UPDATE ${balanceSweepScheduledSlots} AS slot
      SET eligible_after = GREATEST(slot.eligible_after, ${rebaselineEligibleAfter}),
          updated_at = ${now}
      WHERE slot.id IN (SELECT id FROM candidate_slot)
      RETURNING
        slot.id,
        slot.eligible_after,
        slot.status::text AS status
    ),
    inserted_slot AS (
      INSERT INTO ${balanceSweepScheduledSlots} (
        target_id,
        token_mint,
        eligible_after,
        status,
        created_at,
        updated_at
      )
      SELECT
        projection.target_id,
        projection.mint,
        ${rebaselineEligibleAfter},
        'scheduled',
        ${now},
        ${now}
      FROM projection
      CROSS JOIN inserted_event
      WHERE NOT EXISTS (SELECT 1 FROM updated_slot)
      RETURNING
        id,
        eligible_after,
        status::text AS status
    ),
    scheduled_slot AS (
      SELECT id, eligible_after, status FROM updated_slot
      UNION ALL
      SELECT id, eligible_after, status FROM inserted_slot
      LIMIT 1
    ),
    inserted_lot AS (
      INSERT INTO ${balanceSweepSurplusLots} (
        target_id,
        scheduled_slot_id,
        source_event_id,
        source_signature,
        original_amount_raw,
        remaining_amount_raw,
        classification,
        eligible_after,
        status,
        confidence,
        reason,
        created_at,
        updated_at
      )
      SELECT
        projection.target_id,
        scheduled_slot.id,
        inserted_event.event_id,
        NULL,
        projection.amount_raw - ${input.walletBalanceFloorRaw},
        projection.amount_raw - ${input.walletBalanceFloorRaw},
        'floor_rebaseline'::loyal_yield.balance_sweep_surplus_classification,
        ${rebaselineEligibleAfter},
        'open'::loyal_yield.balance_sweep_surplus_lot_status,
        'confirmed_projection',
        'Autodeposit floor update rebaseline',
        ${now},
        ${now}
      FROM projection
      CROSS JOIN inserted_event
      CROSS JOIN scheduled_slot
      RETURNING
        classification::text AS "lotClassification",
        confidence AS "lotConfidence",
        eligible_after AS "lotEligibleAfter",
        id AS "lotId",
        scheduled_slot_id AS "lotSlotId",
        original_amount_raw AS "lotOriginalAmountRaw",
        reason AS "lotReason",
        remaining_amount_raw AS "lotRemainingAmountRaw",
        (SELECT status FROM scheduled_slot) AS "lotStatus"
    )
    SELECT
      projection.amount_raw AS "projectionAmountRaw",
      inserted_lot."lotClassification",
      inserted_lot."lotConfidence",
      inserted_lot."lotEligibleAfter",
      inserted_lot."lotId",
      inserted_lot."lotSlotId",
      inserted_lot."lotOriginalAmountRaw",
      inserted_lot."lotReason",
      inserted_lot."lotRemainingAmountRaw",
      inserted_lot."lotStatus",
      CASE
        WHEN projection.target_id IS NULL THEN 'wallet_balance_projection_missing'
        WHEN projection.amount_raw <= ${
          input.walletBalanceFloorRaw
        } THEN 'wallet_balance_at_or_below_floor'
        ELSE NULL
      END AS "skippedReason"
    FROM updated_target
    LEFT JOIN projection ON true
    LEFT JOIN inserted_lot ON true
  `);
  const [row] = getExecuteRows(queryResult);

  if (!row) {
    throw new Error("Failed to update autodeposit wallet balance floor.");
  }

  const target = {
    ...existing,
    walletBalanceFloorRaw: input.walletBalanceFloorRaw,
  };

  if (row.lotId !== null && row.lotId !== undefined) {
    return {
      rebaselineSweep: {
        status: "scheduled",
        sweep: {
          classification: String(
            row.lotClassification
          ) as PendingEarnAutodepositScheduledSweepRecord["classification"],
          confidence: String(row.lotConfidence),
          eligibleAfter: toDateValue(row.lotEligibleAfter),
          executeNowAvailableAt:
            resolveEarnAutodepositDelegationReadyAt(target),
          id: toBigIntValue(row.lotSlotId),
          lotCount: 1,
          originalAmountRaw: toBigIntValue(row.lotOriginalAmountRaw),
          reason: String(row.lotReason),
          remainingAmountRaw: toBigIntValue(row.lotRemainingAmountRaw),
          slotId: toBigIntValue(row.lotSlotId),
          status: String(
            row.lotStatus
          ) as PendingEarnAutodepositScheduledSweepRecord["status"],
        },
      },
      target,
    };
  }

  const skippedReason =
    row.skippedReason === "wallet_balance_at_or_below_floor"
      ? "wallet_balance_at_or_below_floor"
      : "wallet_balance_projection_missing";

  return {
    rebaselineSweep: {
      reason: skippedReason,
      status: "skipped",
    },
    target,
  };
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

export async function markAutodepositTargetPendingDelegation(
  input: {
    lifecycleStatus?: "pending_delegation" | "pending_policy";
    policyAccount: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client" | "now"
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
    return existing;
  }

  // The closed guard above is read-then-write (Neon HTTP has no
  // transactions), and the caller runs RPC probes between its read and this
  // write — a close confirm landing in that window must win, so the demote
  // is conditional on the row still not being closed.
  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: false,
      lastSeenAt: dependencies.now(),
      lifecycleStatus: input.lifecycleStatus ?? "pending_delegation",
    })
    .where(
      and(
        eq(balanceSweepTargets.policyAccount, input.policyAccount),
        ne(balanceSweepTargets.lifecycleStatus, "closed")
      )
    )
    .returning();

  if (!target) {
    const closed = await findTargetByPolicy({
      client,
      policyAccount: input.policyAccount,
    });
    if (closed?.lifecycleStatus === "closed") {
      return closed;
    }
    throw new Error("Failed to mark autodeposit target pending.");
  }

  return target;
}

export async function markAutodepositTargetActiveFromArtifacts(
  input: {
    policyAccount: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client" | "now"
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
    return existing;
  }
  if (!existing.recurringDelegation) {
    throw new Error("Autodeposit recurring delegation is missing.");
  }

  // Same concurrent-close guard as markAutodepositTargetPendingDelegation:
  // a close recorded between the read above and this write must not be
  // resurrected to active.
  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: true,
      lastSeenAt: dependencies.now(),
      lifecycleStatus: "active",
    })
    .where(
      and(
        eq(balanceSweepTargets.policyAccount, input.policyAccount),
        ne(balanceSweepTargets.lifecycleStatus, "closed")
      )
    )
    .returning();

  if (!target) {
    const closed = await findTargetByPolicy({
      client,
      policyAccount: input.policyAccount,
    });
    if (closed?.lifecycleStatus === "closed") {
      return closed;
    }
    throw new Error("Failed to mark autodeposit target active.");
  }

  return target;
}

// System-pauses a fully-active target whose Earn route policy pair is gone
// (see EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION). active=false is the same
// switch the user toggle uses, so the sweep worker stops scheduling. Only an
// active+lifecycle-"active" row is eligible — closed/pending rows aren't
// sweeping, and a user toggle-off must stay user-owned. The write is
// conditional on that same shape so a concurrent close or demote wins.
export async function markAutodepositTargetPausedMissingPosition(
  input: {
    policyAccount: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client" | "now"
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
  if (existing.lifecycleStatus !== "active" || !existing.active) {
    return existing;
  }

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: false,
      lastSeenAt: dependencies.now(),
      lifecycleStatus: EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION,
    })
    .where(
      and(
        eq(balanceSweepTargets.policyAccount, input.policyAccount),
        eq(balanceSweepTargets.lifecycleStatus, "active"),
        eq(balanceSweepTargets.active, true)
      )
    )
    .returning();

  if (!target) {
    const fresh = await findTargetByPolicy({
      client,
      policyAccount: input.policyAccount,
    });
    return fresh ?? existing;
  }

  return target;
}

// Reverses markAutodepositTargetPausedMissingPosition once a deposit has
// recreated the route policy pair. Conditional on the row still being
// system-paused so it can never resurrect a row a concurrent close confirm
// or artifacts demote has moved elsewhere.
export async function resumeAutodepositTargetFromMissingPosition(
  input: {
    policyAccount: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client" | "now"
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
  if (existing.lifecycleStatus !== EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION) {
    return existing;
  }

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: true,
      lastSeenAt: dependencies.now(),
      lifecycleStatus: "active",
    })
    .where(
      and(
        eq(balanceSweepTargets.policyAccount, input.policyAccount),
        eq(
          balanceSweepTargets.lifecycleStatus,
          EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION
        )
      )
    )
    .returning();

  if (!target) {
    const fresh = await findTargetByPolicy({
      client,
      policyAccount: input.policyAccount,
    });
    return fresh ?? existing;
  }

  return target;
}

// Promotes a setup-stranded target (pending_policy/pending_delegation) to
// active by recording setup confirmations that were lost in flight. Only the
// orphaned-setup heal calls this, after verifying on-chain that the full
// setup (policy + delegation + token approval) exists. Conditional on the
// row still being in a pending lifecycle so it can never race a concurrent
// confirm or close.
export async function activateAutodepositTargetWithBackfilledSetup(
  input: {
    policyAccount: string;
    policyConfirmedSlot: bigint;
    policySignature: string;
    recurringDelegationConfirmedSlot: bigint | null;
    recurringDelegationSignature: string | null;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client" | "now"
  > = createDependencies()
): Promise<BalanceSweepTargetRecord | null> {
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
  if (
    existing.lifecycleStatus !== "pending_policy" &&
    existing.lifecycleStatus !== "pending_delegation"
  ) {
    return existing.lifecycleStatus === "active" ? existing : null;
  }

  const policySignature = existing.policySignature ?? input.policySignature;
  const policyConfirmedSlot =
    existing.policyConfirmedSlot ?? input.policyConfirmedSlot;
  const recurringDelegationSignature =
    existing.recurringDelegationSignature ??
    input.recurringDelegationSignature;
  const recurringDelegationConfirmedSlot =
    existing.recurringDelegationConfirmedSlot ??
    input.recurringDelegationConfirmedSlot;
  if (
    !policySignature ||
    policyConfirmedSlot === null ||
    !recurringDelegationSignature ||
    recurringDelegationConfirmedSlot === null
  ) {
    return null;
  }

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: true,
      lastSeenAt: dependencies.now(),
      lifecycleStatus: "active",
      policyConfirmedSlot,
      policySignature,
      recurringDelegationConfirmedSlot,
      recurringDelegationSignature,
    })
    .where(
      and(
        eq(balanceSweepTargets.policyAccount, input.policyAccount),
        inArray(balanceSweepTargets.lifecycleStatus, [
          "pending_policy",
          "pending_delegation",
        ])
      )
    )
    .returning();

  return target ?? null;
}

// Same shape as reconcileStaleEarnAutodepositScheduledSweeps but
// unconditional on surplus: a paused target's sweeps can never execute, so
// open lots are suppressed (their 'scheduled' slots empty out and stay
// reusable after a resume) and finished 'failed'/'released' slots stop
// rendering as an eternal "Execute now".
export async function suppressEarnAutodepositScheduledSweepsForMissingPosition(
  args: { target: Pick<BalanceSweepTargetRecord, "id"> },
  dependencies: EarnAutodepositRepositoryDependencies = createDependencies()
): Promise<{ canceledSlotCount: number; suppressedLotCount: number }> {
  const { client } = dependencies;
  const now = dependencies.now();

  const suppressed = await client.db.execute(sql`
    UPDATE ${balanceSweepSurplusLots}
    SET status = 'suppressed', updated_at = ${now}
    WHERE ${balanceSweepSurplusLots.targetId} = ${args.target.id}
      AND ${balanceSweepSurplusLots.status} = 'open'
      AND ${balanceSweepSurplusLots.remainingAmountRaw} > 0
    RETURNING ${balanceSweepSurplusLots.id}
  `);

  const canceled = await client.db.execute(sql`
    UPDATE ${balanceSweepScheduledSlots}
    SET status = 'canceled',
        last_error = 'reconciled: autodeposit paused, Earn position closed',
        updated_at = ${now}
    WHERE ${balanceSweepScheduledSlots.targetId} = ${args.target.id}
      AND ${balanceSweepScheduledSlots.status} IN ('failed', 'released')
    RETURNING ${balanceSweepScheduledSlots.id}
  `);

  return {
    canceledSlotCount: getExecuteRows(canceled).length,
    suppressedLotCount: getExecuteRows(suppressed).length,
  };
}

// Records a close observed on-chain rather than through the close confirm:
// both stage transactions were recorded for this row, yet the policy AND
// recurring delegation accounts are gone from chain — the close transaction
// landed but its confirm never reached the DB (or lost a write race). Without
// this the reconciler demotes the row to pending_delegation and it lingers as
// a live autodeposit forever. No close signature is available here, so the
// close proof columns stay untouched for a later confirm retry to fill.
export async function markAutodepositTargetClosedFromChain(
  input: {
    policyAccount: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client" | "now"
  > = createDependencies()
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
    existing.vaultIndex !== input.vaultIndex
  ) {
    throw new Error("Autodeposit target does not match the wallet.");
  }

  await cancelScheduledAutodepositTransactionsForClose({
    client,
    now,
    targetId: existing.id,
  });

  if (existing.lifecycleStatus === "closed") {
    return existing;
  }

  await client.db
    .update(balanceSweepPolicies)
    .set({
      active: false,
      closedAt: sql`COALESCE(${balanceSweepPolicies.closedAt}, ${now})`,
      lastSeenAt: now,
    })
    .where(eq(balanceSweepPolicies.policyAccount, input.policyAccount));

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      active: false,
      closedAt: sql`COALESCE(${balanceSweepTargets.closedAt}, ${now})`,
      lastSeenAt: now,
      lifecycleStatus: "closed",
    })
    .where(eq(balanceSweepTargets.policyAccount, input.policyAccount))
    .returning();

  if (!target) {
    throw new Error("Failed to close autodeposit target from chain state.");
  }

  return target;
}

export type AutodepositStageProof = {
  confirmedSlot: bigint;
  signature: string;
};

// Fills stage proof columns that a lost confirm left NULL (the stage's
// transaction landed on-chain but its confirm never reached the DB, so the
// row can never satisfy the recorded-proof promotion guard). COALESCE keeps
// any recorded proof authoritative — the backfill only ever completes a row,
// never rewrites it. Lifecycle promotion stays with the reconciler.
export async function backfillAutodepositTargetStageProofs(
  input: {
    policyAccount: string;
    policyProof: AutodepositStageProof | null;
    recurringDelegationProof: AutodepositStageProof | null;
    settings: string;
    vaultIndex: number;
    walletAddress: string;
  },
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client" | "now"
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
    return existing;
  }
  if (!input.policyProof && !input.recurringDelegationProof) {
    return existing;
  }

  const [target] = await client.db
    .update(balanceSweepTargets)
    .set({
      lastSeenAt: dependencies.now(),
      ...(input.policyProof
        ? {
            policySignature: sql`COALESCE(${balanceSweepTargets.policySignature}, ${input.policyProof.signature})`,
            policyConfirmedSlot: sql`COALESCE(${
              balanceSweepTargets.policyConfirmedSlot
            }, ${input.policyProof.confirmedSlot.toString()}::bigint)`,
          }
        : {}),
      ...(input.recurringDelegationProof
        ? {
            recurringDelegationSignature: sql`COALESCE(${balanceSweepTargets.recurringDelegationSignature}, ${input.recurringDelegationProof.signature})`,
            recurringDelegationConfirmedSlot: sql`COALESCE(${
              balanceSweepTargets.recurringDelegationConfirmedSlot
            }, ${input.recurringDelegationProof.confirmedSlot.toString()}::bigint)`,
          }
        : {}),
    })
    .where(eq(balanceSweepTargets.policyAccount, input.policyAccount))
    .returning();

  if (!target) {
    throw new Error("Failed to backfill autodeposit target proofs.");
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
    .where(
      and(
        eq(balanceSweepWalletBalancesCurrent.targetId, input.targetId),
        eq(balanceSweepWalletBalancesCurrent.mint, input.mint)
      )
    )
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
      walletTokenAta: input.walletTokenAta,
      walletUsdcAta: input.walletUsdcAta,
    })
    .onConflictDoUpdate({
      target: [
        balanceSweepWalletBalancesCurrent.targetId,
        balanceSweepWalletBalancesCurrent.mint,
      ],
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
        walletTokenAta: input.walletTokenAta,
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
      destinationTokenAta: input.destinationTokenAta,
      destinationPostBalanceRaw: input.destinationPostBalanceRaw ?? null,
      destinationPreBalanceRaw: input.destinationPreBalanceRaw ?? null,
      destinationVaultAta: input.destinationVaultAta,
      insertedAt: now,
      rawEvidence: input.rawEvidence ?? null,
      receivedAt: input.receivedAt ?? now,
      signature: input.signature,
      slot: input.slot,
      sourceCommitment: input.sourceCommitment,
      sourceTokenAta: input.sourceTokenAta,
      sourcePostBalanceRaw: input.sourcePostBalanceRaw ?? null,
      sourcePreBalanceRaw: input.sourcePreBalanceRaw ?? null,
      sourceWalletAta: input.sourceWalletAta,
      targetId: input.targetId,
      tokenMint: input.tokenMint,
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

// Distinct wallet addresses with a balance-sweep execution recorded since
// `since` (DB insert time). Used by the Solana Week attribution cron to report
// "first Earn deposit via autodeposit" quest completions. The completion API is
// idempotent per (wallet, quest), so a generous lookback window is safe.
export async function findWalletAddressesWithBalanceSweepsSince(
  since: Date,
  dependencies: Pick<
    EarnAutodepositRepositoryDependencies,
    "client"
  > = createDependencies()
): Promise<string[]> {
  const rows = await dependencies.client.db
    .selectDistinct({ wallet: balanceSweepTargets.wallet })
    .from(balanceSweepExecutions)
    .innerJoin(
      balanceSweepTargets,
      eq(balanceSweepExecutions.targetId, balanceSweepTargets.id)
    )
    .where(gte(balanceSweepExecutions.insertedAt, since));

  return rows.map((row) => row.wallet);
}
