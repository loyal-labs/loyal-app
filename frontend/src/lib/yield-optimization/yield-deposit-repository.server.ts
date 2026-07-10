import "server-only";

import {
  RiskBasket,
  createYieldRoutePolicyPlan,
  createYieldRouteSetupPolicyPlan,
  normalizeLoyalCluster,
  type YieldRoutePolicyPlan,
  type YieldRouteSetupPolicyPlan,
} from "@loyal-labs/actions";
import { PublicKey } from "@solana/web3.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  earnDepositOnboardingAttempts,
  getYieldOptimizationClient,
  managedVaults,
  rebalanceDecisions,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositionHoldingEvents,
  userYieldPositionWithdrawals,
  userYieldPositions,
  vaultIdleTokenBalancesCurrent,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  vaultReservePositionsCurrent,
  type YieldOptimizationClient,
  type YieldWithdrawalReserveMetadata,
} from "./yield-neon-client.server";

export type ConfirmedYieldDepositInput = {
  cluster: string;
  walletAddress: string;
  delegatedSigner: string;
  smartAccountAddress: string;
  settings: string;
  vaultIndex: number;
  vaultPubkey: string;
  policyId: bigint;
  policyAccount: string;
  policyInitialization: "create" | "reuse";
  policySeed: bigint;
  policySignature: string;
  policyConfirmedSlot?: bigint | null;
  setupPolicyId?: bigint | null;
  setupPolicyAccount?: string | null;
  setupPolicySeed?: bigint | null;
  setupPolicySignature?: string | null;
  setupPolicyConfirmedSlot?: bigint | null;
  depositSignature: string;
  confirmedSlot: bigint;
  targetReserve: string;
  market: string | null;
  liquidityMint: string;
  targetSupplyApyBps: bigint | null;
  depositMint: string;
  principalAmountRaw: bigint;
};

export type ConfirmedYieldRoutePolicyInput = {
  cluster: string;
  walletAddress: string;
  delegatedSigner: string;
  settings: string;
  vaultIndex: number;
  vaultPubkey: string;
  policyId: bigint;
  policyAccount: string;
  policySeed: bigint;
  policySignature: string;
  policyConfirmedSlot?: bigint | null;
  setupPolicyId?: bigint | null;
  setupPolicyAccount?: string | null;
  setupPolicySeed?: bigint | null;
  setupPolicySignature?: string | null;
  setupPolicyConfirmedSlot?: bigint | null;
  confirmedSlot: bigint;
  targetReserve: string;
  market: string | null;
  liquidityMint: string;
};

export type UserYieldPositionRecord = typeof userYieldPositions.$inferSelect;
export type UserYieldPositionHoldingEventRecord =
  typeof userYieldPositionHoldingEvents.$inferSelect;
type UserYieldPositionWithdrawalRecord =
  typeof userYieldPositionWithdrawals.$inferSelect;
export type RoutePolicyRecord = typeof routePolicies.$inferSelect;
export type UserYieldPositionEventRecord = {
  amountRaw: bigint;
  confirmedAt: Date;
  type: "deposit" | "withdrawal";
};
export type UserYieldPositionHistoryEventRecord = {
  amountRaw: bigint;
  confirmedAt: Date;
  confirmedSlot: bigint;
  eventType: UserYieldPositionHoldingEventRecord["eventType"];
  id: bigint;
  reserve: string;
  market: string | null;
  principalDeltaRaw: bigint | null;
  withdrawnAmountRaw?: bigint | null;
  liquidityMint: string;
  sourceReserve?: string | null;
  sourceMarket?: string | null;
  sourceLiquidityMint?: string | null;
  destinationReserve?: string | null;
  destinationMarket?: string | null;
  destinationLiquidityMint?: string | null;
  principalAmountRaw: bigint;
  signature: string;
  type: "deposit" | "withdrawal" | "rebalance" | "reconciliation";
};

export type ActiveYieldPositionLookupInput = {
  cluster: string;
  initialReserve: string;
  settings: string;
  vaultIndex: number;
  walletAddress: string;
};

export type ActiveYieldPositionForVaultLookupInput = Omit<
  ActiveYieldPositionLookupInput,
  "initialReserve"
>;
type ReconciledActiveYieldPositionForVaultLookupInput =
  ActiveYieldPositionForVaultLookupInput & {
    skipCurrentRowsObservedAtOrAfterSlot?: bigint;
  };

export type SyncConfirmedRebalanceHoldingEventsResult = {
  insertedCount: number;
  updatedPositionCount: number;
};

export type YieldPositionEventsLookupInput = ActiveYieldPositionLookupInput & {
  vaultPubkey?: string;
};

export type CurrentYieldVaultReservePositionRecord =
  typeof vaultReservePositionsCurrent.$inferSelect;
export type CurrentYieldVaultIdleTokenBalanceRecord =
  typeof vaultIdleTokenBalancesCurrent.$inferSelect;
export type ManagedYieldVaultRecord = typeof managedVaults.$inferSelect;
export type EarnDepositOnboardingAttemptRecord =
  typeof earnDepositOnboardingAttempts.$inferSelect;

export type EarnDepositOnboardingStatus =
  | "route_policy_confirmed"
  | "setup_policy_confirmed"
  | "deposit_confirmed"
  | "accounting_failed"
  | "complete";

export type EarnDepositOnboardingNextStep =
  | "route_policy"
  | "setup_policy"
  | "deposit"
  | "deposit_accounting_retry"
  | "complete";

export type ActiveManagedYieldVaultWithPolicy = {
  routePolicy: RoutePolicyRecord;
  setupPolicy: RoutePolicyRecord | null;
  vault: ManagedYieldVaultRecord;
};

export type ReconciledYieldVaultReservePositionInput = {
  amountRaw: bigint;
  borrowApyBps?: bigint | null;
  hasValue: boolean;
  liquidityMint: string;
  market: string | null;
  planningMetadata?: Record<string, unknown>;
  reserve: string;
  supplyApyBps?: bigint | null;
};

export type ReconciledYieldVaultIdleTokenBalanceInput = {
  amountRaw: bigint;
  mint: string;
  owner: string;
  tokenAccount: string;
};

export type ReconciledYieldVaultSnapshotInput = {
  chainSlot?: bigint | null;
  context: Record<string, unknown>;
  idleTokenBalance: ReconciledYieldVaultIdleTokenBalanceInput;
  observedAt?: Date;
  observedSlot: bigint;
  policyId: bigint;
  positions: ReconciledYieldVaultReservePositionInput[];
  sourceCommitment: string;
  vaultId: bigint;
};

export type ConfirmedYieldWithdrawalAutodepositCloseInput = {
  closeSignature: string;
  confirmedSlot: bigint;
  delegatedSigner: string;
  policyAccount: string;
  recurringDelegation: string;
};

export type ConfirmedYieldWithdrawalInput = {
  cluster: string;
  walletAddress: string;
  delegatedSigner: string;
  smartAccountAddress: string;
  settings: string;
  vaultIndex: number;
  vaultPubkey: string;
  policyId: bigint;
  policyAccount: string;
  policySeed: bigint;
  setupPolicyId?: bigint | null;
  setupPolicyAccount?: string | null;
  setupPolicySeed?: bigint | null;
  withdrawalSignature: string;
  confirmedSlot: bigint;
  targetReserve: string;
  market: string | null;
  liquidityMint: string;
  withdrawnAmountRaw: bigint;
  mode: "partial" | "full";
  confirmedReserveDebitAmountRaw?: bigint | null;
  confirmedVaultIdleDeltaRaw?: bigint | null;
  confirmedVaultIdleTokenAccount?: string | null;
  confirmedWalletTransferAmountRaw?: bigint | null;
  sourceAmountRaw?: bigint | null;
  sourceId?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  sourceMint?: string | null;
  sourceTokenAccount?: string | null;
  sourceType?: "reserve" | "idle" | null;
  autodepositClose?: ConfirmedYieldWithdrawalAutodepositCloseInput | null;
  accountingReserve?: string | null;
  executionReserve?: string | null;
  isFinalStep?: boolean | null;
  reserveWithdrawals?: YieldWithdrawalReserveMetadata[] | null;
  stepCount?: number | null;
  stepIndex?: number | null;
};

export type ConfirmedYieldRebalanceInput = {
  positionId: bigint;
  cluster: string;
  reserve: string;
  market: string | null;
  liquidityMint: string;
  amountRaw: bigint;
  observedSlot: bigint;
  observedAt?: Date;
  sourceSignature: string;
  sourceRebalanceDecisionId: bigint;
  sourceSnapshotId: bigint;
};

export type SnapshotReconciliationInput = {
  positionId: bigint;
  cluster: string;
  reserve: string;
  market: string | null;
  liquidityMint: string;
  amountRaw: bigint;
  observedSlot: bigint;
  observedAt?: Date;
  sourceSnapshotId: bigint;
};

// Sub-cent idle USDC must not block a final exit. Shared by the withdraw
// prepare routes (which close the on-chain policies on this basis) and the
// confirm-side resolveWithdrawalSource (which releases the DB policy rows).
// Prepare and confirm MUST agree: when prepare closes the policies but confirm
// keeps the DB pair active, the next deposit adopts dead policy accounts and
// every subsequent withdraw prepare fails with "Unable to find Policy account".
export const EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW = BigInt(10_000); // $0.01

const REDEEMABLE_LIQUIDITY_AMOUNT_SEMANTICS = new Set([
  "kamino_redeemable_liquidity",
]);

const COLLATERAL_UNIT_AMOUNT_SEMANTICS = new Set([
  "kamino_obligation_collateral_deposited_amount",
]);

function metadataStringValue(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function getReserveAmountSemantics(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  return metadataStringValue(metadata, ["amountSemantics", "amount_semantics"]);
}

export function isUserFacingReserveAmountMetadata(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  const semantics = getReserveAmountSemantics(metadata);
  return (
    semantics !== null && REDEEMABLE_LIQUIDITY_AMOUNT_SEMANTICS.has(semantics)
  );
}

function hasCollateralUnitAmountSemantics(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  const semantics = getReserveAmountSemantics(metadata);
  return semantics !== null && COLLATERAL_UNIT_AMOUNT_SEMANTICS.has(semantics);
}

export function filterUserFacingYieldVaultReservePositions<
  T extends { planningMetadata: Record<string, unknown> }
>(rows: T[]): T[] {
  return rows.filter((row) =>
    isUserFacingReserveAmountMetadata(row.planningMetadata)
  );
}

export type YieldPositionVerificationFailureReason =
  | "negative_principal"
  | "negative_holding"
  | "missing_holding_events"
  | "missing_provenance"
  | "principal_mismatch"
  | "current_projection_mismatch"
  | "stale_last_holding_event"
  | "rebalance_decision_not_confirmed";

export type YieldPositionVerificationFailure = {
  positionId: bigint;
  walletAddress: string;
  settings: string;
  expectedPrincipalAmountRaw: bigint;
  storedPrincipalAmountRaw: bigint;
  expectedCurrentHolding: {
    reserve: string | null;
    market: string | null;
    liquidityMint: string | null;
    amountRaw: bigint | null;
    observedSlot: bigint | null;
    observedAt: Date | null;
    lastHoldingEventId: bigint | null;
  };
  storedCurrentHolding: {
    reserve: string;
    market: string | null;
    liquidityMint: string;
    amountRaw: bigint;
    observedSlot: bigint;
    observedAt: Date;
    lastHoldingEventId: bigint | null;
  };
  reason: YieldPositionVerificationFailureReason;
};

export type ActiveYieldRoutePolicyPair = {
  routePolicy: RoutePolicyRecord;
  setupPolicy: RoutePolicyRecord | null;
};
export type EarnCleanupVaultState = {
  idleRows: CurrentYieldVaultIdleTokenBalanceRecord[];
  reserveRows: CurrentYieldVaultReservePositionRecord[];
  routePolicy: RoutePolicyRecord;
  setupPolicy: RoutePolicyRecord | null;
  vault: ManagedYieldVaultRecord;
};

export type ConfirmedEarnCleanupInput = {
  cleanupSignature: string;
  cluster: string;
  confirmedSlot: bigint;
  settings: string;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
};

type YieldDepositRepositoryDependencies = {
  client: YieldOptimizationClient;
  now: () => Date;
};

type AggregatePositionUpsertMode = "increment-principal" | "recover-principal";
type IdempotentDepositAccountingResult =
  | {
      kind: "complete";
      position: UserYieldPositionRecord;
    }
  | {
      depositId: bigint;
      kind: "recover";
    }
  | null;

function sortYieldPositionHistoryEventsDescending(
  events: UserYieldPositionHistoryEventRecord[]
): UserYieldPositionHistoryEventRecord[] {
  return [...events].sort((a, b) => {
    const confirmedAtDelta = b.confirmedAt.getTime() - a.confirmedAt.getTime();
    if (confirmedAtDelta !== 0) {
      return confirmedAtDelta;
    }

    const signatureDelta = a.signature.localeCompare(b.signature);
    if (signatureDelta !== 0) {
      return signatureDelta;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function createDependencies(): YieldDepositRepositoryDependencies {
  return {
    client: getYieldOptimizationClient(),
    now: () => new Date(),
  };
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

function readExecuteCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    return Number.parseInt(value, 10);
  }
  return 0;
}

function currentPositionMatchesHoldingEvent(
  position: UserYieldPositionRecord,
  event: UserYieldPositionHoldingEventRecord
): boolean {
  return (
    position.currentReserve === event.reserve &&
    position.currentMarket === event.market &&
    position.currentLiquidityMint === event.liquidityMint &&
    position.currentAmountRaw === event.amountRaw &&
    position.currentObservedSlot === event.observedSlot &&
    position.currentObservedAt.getTime() === event.observedAt.getTime() &&
    position.lastHoldingEventId === event.id
  );
}

function currentVaultPositionMatchesEvent(
  current: typeof vaultReservePositionsCurrent.$inferSelect,
  event: UserYieldPositionHoldingEventRecord
): boolean {
  return (
    current.reserve === event.reserve &&
    current.market === event.market &&
    current.liquidityMint === event.liquidityMint &&
    current.amountRaw === event.amountRaw &&
    current.observedSlot === event.observedSlot &&
    current.observedAt.getTime() === event.observedAt.getTime()
  );
}

async function findLatestHoldingEventForPosition(
  positionId: bigint,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">
): Promise<UserYieldPositionHoldingEventRecord | null> {
  const [event] = await dependencies.client.db
    .select()
    .from(userYieldPositionHoldingEvents)
    .where(eq(userYieldPositionHoldingEvents.positionId, positionId))
    .orderBy(
      desc(userYieldPositionHoldingEvents.observedSlot),
      desc(userYieldPositionHoldingEvents.observedAt),
      desc(userYieldPositionHoldingEvents.id)
    )
    .limit(1);

  return (event as UserYieldPositionHoldingEventRecord | undefined) ?? null;
}

async function holdingEventUsesCollateralUnitSnapshot(
  event: UserYieldPositionHoldingEventRecord | null,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">
): Promise<boolean> {
  if (
    !event ||
    event.eventType !== "snapshot_reconciled" ||
    event.sourceSnapshotId === null
  ) {
    return false;
  }

  const [snapshotPosition] = await dependencies.client.db
    .select({
      planningMetadata: vaultPositionSnapshotPositions.planningMetadata,
    })
    .from(vaultPositionSnapshotPositions)
    .where(
      and(
        eq(vaultPositionSnapshotPositions.snapshotId, event.sourceSnapshotId),
        eq(vaultPositionSnapshotPositions.reserve, event.reserve),
        eq(vaultPositionSnapshotPositions.liquidityMint, event.liquidityMint),
        eq(vaultPositionSnapshotPositions.amountRaw, event.amountRaw)
      )
    )
    .limit(1);

  return hasCollateralUnitAmountSemantics(
    snapshotPosition?.planningMetadata ?? null
  );
}

function principalBackedPositionProjection(
  position: UserYieldPositionRecord,
  event: UserYieldPositionHoldingEventRecord | null
): UserYieldPositionRecord {
  if (position.principalAmountRaw <= BigInt(0)) {
    return position;
  }

  return {
    ...position,
    currentAmountRaw: position.principalAmountRaw,
    currentLiquidityMint:
      event?.liquidityMint ?? position.currentLiquidityMint,
    currentMarket: event?.market ?? position.currentMarket,
    currentObservedAt: event?.observedAt ?? position.currentObservedAt,
    currentObservedSlot: event?.observedSlot ?? position.currentObservedSlot,
    currentReserve: event?.reserve ?? position.currentReserve,
  };
}

async function projectPositionForUserFacingRead(
  position: UserYieldPositionRecord,
  latestEvent: UserYieldPositionHoldingEventRecord | null,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">
): Promise<UserYieldPositionRecord> {
  return (await holdingEventUsesCollateralUnitSnapshot(
    latestEvent,
    dependencies
  ))
    ? principalBackedPositionProjection(position, latestEvent)
    : position;
}

async function recordZeroCurrentVaultPositionsAfterFullWithdrawal(
  input: ConfirmedYieldWithdrawalInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client" | "now">
): Promise<void> {
  const vault = await dependencies.client.db.query.managedVaults.findFirst({
    where: and(
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, input.vaultPubkey)
    ),
  });
  if (!vault) {
    return;
  }

  const currentRows = await dependencies.client.db
    .select()
    .from(vaultReservePositionsCurrent)
    .where(eq(vaultReservePositionsCurrent.vaultId, vault.id));
  if (currentRows.length === 0) {
    return;
  }
  const alreadyZeroCurrent = currentRows.every(
    (row) => row.amountRaw === BigInt(0) && !row.hasValue
  );
  if (alreadyZeroCurrent) {
    return;
  }

  const observedAt = dependencies.now();
  const [snapshot] = await dependencies.client.db
    .insert(vaultPositionSnapshots)
    .values({
      chainSlot: input.confirmedSlot,
      context: {
        source: "frontend_full_withdraw",
        withdrawalSignature: input.withdrawalSignature,
      },
      isCurrent: false,
      observedAt,
      observedSlot: input.confirmedSlot,
      policyId: vault.activePolicyId,
      vaultId: vault.id,
    })
    .returning({ id: vaultPositionSnapshots.id });
  if (!snapshot) {
    return;
  }

  await dependencies.client.db.batch([
    dependencies.client.db.insert(vaultPositionSnapshotPositions).values(
      currentRows.map((row) => ({
        amountRaw: BigInt(0),
        borrowApyBps: row.borrowApyBps,
        hasValue: false,
        liquidityMint: row.liquidityMint,
        market: row.market,
        planningMetadata: {
          ...row.planningMetadata,
          source: "frontend_full_withdraw",
        },
        reserve: row.reserve,
        snapshotId: snapshot.id,
        supplyApyBps: row.supplyApyBps,
      }))
    ) as never,
    dependencies.client.db
      .update(vaultPositionSnapshots)
      .set({ isCurrent: false })
      .where(eq(vaultPositionSnapshots.vaultId, vault.id)) as never,
    dependencies.client.db
      .update(vaultReservePositionsCurrent)
      .set({
        amountRaw: BigInt(0),
        hasValue: false,
        observedAt,
        observedSlot: input.confirmedSlot,
        snapshotId: snapshot.id,
      })
      .where(eq(vaultReservePositionsCurrent.vaultId, vault.id)) as never,
    dependencies.client.db
      .update(vaultPositionSnapshots)
      .set({ isCurrent: true })
      .where(eq(vaultPositionSnapshots.id, snapshot.id)) as never,
  ]);
}

async function deactivateVaultAfterFullWithdrawal(
  input: ConfirmedYieldWithdrawalInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">,
  now: Date
): Promise<void> {
  const vault = await dependencies.client.db.query.managedVaults.findFirst({
    where: and(
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, input.vaultPubkey)
    ),
  });
  if (!vault) {
    return;
  }

  const policyIds = [vault.activePolicyId, vault.setupPolicyId].filter(
    (policyId): policyId is bigint => typeof policyId === "bigint"
  );

  if (policyIds.length === 0) {
    const deactivateVault = dependencies.client.db
      .update(managedVaults)
      .set({ active: false, lastSeenAt: now })
      .where(eq(managedVaults.id, vault.id)) as never;

    await dependencies.client.db.batch([deactivateVault]);
    return;
  }

  const deactivatePolicies = dependencies.client.db
    .update(routePolicies)
    .set({
      active: false,
      lastSeenAt: now,
      lastSeenSignature: input.withdrawalSignature,
      lastSeenSlot: input.confirmedSlot,
    })
    .where(inArray(routePolicies.id, policyIds)) as never;
  const deactivateVault = dependencies.client.db
    .update(managedVaults)
    .set({ active: false, lastSeenAt: now })
    .where(eq(managedVaults.id, vault.id)) as never;

  await dependencies.client.db.batch([deactivatePolicies, deactivateVault]);
}

export async function recordConfirmedEarnCleanup(
  input: ConfirmedEarnCleanupInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<void> {
  const { client } = dependencies;
  const now = dependencies.now();
  const vault = await client.db.query.managedVaults.findFirst({
    where: and(
      eq(managedVaults.active, true),
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, input.vaultPubkey)
    ),
  });
  if (!vault) {
    return;
  }

  const policyIds = [vault.activePolicyId, vault.setupPolicyId].filter(
    (policyId): policyId is bigint => typeof policyId === "bigint"
  );
  const zeroReserveRows = client.db
    .update(vaultReservePositionsCurrent)
    .set({
      amountRaw: BigInt(0),
      hasValue: false,
      observedAt: now,
      observedSlot: input.confirmedSlot,
      planningMetadata: {
        source: "frontend_earn_cleanup",
        cleanupSignature: input.cleanupSignature,
      },
    })
    .where(eq(vaultReservePositionsCurrent.vaultId, vault.id)) as never;
  const zeroIdleRows = client.db
    .update(vaultIdleTokenBalancesCurrent)
    .set({
      amountRaw: BigInt(0),
      observedAt: now,
      observedSlot: input.confirmedSlot,
      sourceCommitment: "confirmed_cleanup",
      updatedAt: now,
    })
    .where(eq(vaultIdleTokenBalancesCurrent.vaultId, vault.id)) as never;
  const closeActivePositions = client.db
    .update(userYieldPositions)
    .set({
      currentAmountRaw: BigInt(0),
      currentObservedAt: now,
      currentObservedSlot: input.confirmedSlot,
      lastConfirmedSlot: input.confirmedSlot,
      principalAmountRaw: BigInt(0),
      status: "closed",
      updatedAt: now,
    })
    .where(
      and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.vaultPubkey, input.vaultPubkey),
        eq(userYieldPositions.walletAddress, input.walletAddress),
        eq(userYieldPositions.status, "active")
      )
    ) as never;
  const deactivateVault = client.db
    .update(managedVaults)
    .set({ active: false, lastSeenAt: now })
    .where(eq(managedVaults.id, vault.id)) as never;

  if (policyIds.length === 0) {
    await client.db.batch([
      zeroReserveRows,
      zeroIdleRows,
      closeActivePositions,
      deactivateVault,
    ]);
    return;
  }

  const deactivatePolicies = client.db
    .update(routePolicies)
    .set({
      active: false,
      lastSeenAt: now,
      lastSeenSignature: input.cleanupSignature,
      lastSeenSlot: input.confirmedSlot,
    })
    .where(inArray(routePolicies.id, policyIds)) as never;

  await client.db.batch([
    deactivatePolicies,
    zeroReserveRows,
    zeroIdleRows,
    closeActivePositions,
    deactivateVault,
  ]);
}

async function recordCurrentVaultSourceWithdrawal(args: {
  dependencies: Pick<YieldDepositRepositoryDependencies, "client" | "now">;
  input: ConfirmedYieldWithdrawalInput;
  resolution: WithdrawalSourceResolution;
}): Promise<void> {
  const { dependencies, input, resolution } = args;
  const observedAt = dependencies.now();

  if (resolution.sourceType === "idle") {
    const idleRow = resolution.selectedIdleRow;
    if (!idleRow) {
      return;
    }
    await dependencies.client.db
      .update(vaultIdleTokenBalancesCurrent)
      .set({
        amountRaw:
          idleRow.amountRaw > input.withdrawnAmountRaw
            ? idleRow.amountRaw - input.withdrawnAmountRaw
            : BigInt(0),
        observedAt,
        observedSlot: input.confirmedSlot,
        sourceCommitment: "confirmed_withdrawal",
        updatedAt: observedAt,
      })
      .where(
        and(
          eq(vaultIdleTokenBalancesCurrent.vaultId, resolution.vault.id),
          eq(vaultIdleTokenBalancesCurrent.mint, idleRow.mint)
        )
      );
    return;
  }

  const selectedReserve = resolution.selectedReserveRow;
  if (!selectedReserve || resolution.reserveRows.length === 0) {
    return;
  }
  const sourceDebitAmountRaw = getWithdrawalSourceDebitAmountRaw(
    input,
    "reserve"
  );

  const nextRows = resolution.reserveRows.map((row) => {
    const nextAmountRaw =
      reserveRowsRepresentSameHolding(row, selectedReserve)
        ? row.amountRaw > sourceDebitAmountRaw
          ? row.amountRaw - sourceDebitAmountRaw
          : BigInt(0)
        : row.amountRaw;
    return {
      ...row,
      amountRaw: nextAmountRaw,
      hasValue: nextAmountRaw > BigInt(0),
      observedAt,
      observedSlot: input.confirmedSlot,
      planningMetadata: {
        ...row.planningMetadata,
        source: "frontend_source_withdrawal",
        withdrawalSignature: input.withdrawalSignature,
      },
    };
  });

  const [snapshot] = await dependencies.client.db
    .insert(vaultPositionSnapshots)
    .values({
      chainSlot: input.confirmedSlot,
      context: {
        source: "frontend_source_withdrawal",
        sourceId: resolution.sourceId,
        sourceType: resolution.sourceType,
        withdrawalSignature: input.withdrawalSignature,
      },
      isCurrent: false,
      observedAt,
      observedSlot: input.confirmedSlot,
      policyId: resolution.vault.activePolicyId,
      vaultId: resolution.vault.id,
    })
    .returning({ id: vaultPositionSnapshots.id });
  if (!snapshot) {
    return;
  }

  const snapshotPositionValues = nextRows.map((row) => ({
    amountRaw: row.amountRaw,
    borrowApyBps: row.borrowApyBps,
    hasValue: row.hasValue,
    liquidityMint: row.liquidityMint,
    market: row.market,
    planningMetadata: row.planningMetadata,
    reserve: row.reserve,
    snapshotId: snapshot.id,
    supplyApyBps: row.supplyApyBps,
  }));
  const currentPositionValues = nextRows.map((row) => ({
    amountRaw: row.amountRaw,
    borrowApyBps: row.borrowApyBps,
    hasValue: row.hasValue,
    liquidityMint: row.liquidityMint,
    market: row.market,
    observedAt,
    observedSlot: input.confirmedSlot,
    planningMetadata: row.planningMetadata,
    reserve: row.reserve,
    snapshotId: snapshot.id,
    supplyApyBps: row.supplyApyBps,
    vaultId: resolution.vault.id,
  }));

  await dependencies.client.db.batch([
    dependencies.client.db
      .update(vaultPositionSnapshots)
      .set({ isCurrent: false })
      .where(eq(vaultPositionSnapshots.vaultId, resolution.vault.id)) as never,
    dependencies.client.db
      .insert(vaultPositionSnapshotPositions)
      .values(snapshotPositionValues) as never,
    dependencies.client.db
      .delete(vaultReservePositionsCurrent)
      .where(
        eq(vaultReservePositionsCurrent.vaultId, resolution.vault.id)
      ) as never,
    dependencies.client.db
      .insert(vaultReservePositionsCurrent)
      .values(currentPositionValues) as never,
    dependencies.client.db
      .update(vaultPositionSnapshots)
      .set({ isCurrent: true })
      .where(eq(vaultPositionSnapshots.id, snapshot.id)) as never,
  ]);

  const vaultIdleDeltaRaw = input.confirmedVaultIdleDeltaRaw ?? BigInt(0);
  if (vaultIdleDeltaRaw <= BigInt(0) || !input.confirmedVaultIdleTokenAccount) {
    return;
  }

  const [existingIdleRow] = await dependencies.client.db
    .select()
    .from(vaultIdleTokenBalancesCurrent)
    .where(
      and(
        eq(vaultIdleTokenBalancesCurrent.vaultId, resolution.vault.id),
        eq(vaultIdleTokenBalancesCurrent.mint, input.liquidityMint)
      )
    )
    .limit(1);

  if (existingIdleRow) {
    await dependencies.client.db
      .update(vaultIdleTokenBalancesCurrent)
      .set({
        amountRaw: existingIdleRow.amountRaw + vaultIdleDeltaRaw,
        observedAt,
        observedSlot: input.confirmedSlot,
        owner: input.vaultPubkey,
        sourceCommitment: "confirmed_withdrawal",
        tokenAccount: input.confirmedVaultIdleTokenAccount,
        updatedAt: observedAt,
      })
      .where(
        and(
          eq(vaultIdleTokenBalancesCurrent.vaultId, resolution.vault.id),
          eq(vaultIdleTokenBalancesCurrent.mint, input.liquidityMint)
        )
      );
    return;
  }

  await dependencies.client.db.insert(vaultIdleTokenBalancesCurrent).values({
    amountRaw: vaultIdleDeltaRaw,
    mint: input.liquidityMint,
    observedAt,
    observedSlot: input.confirmedSlot,
    owner: input.vaultPubkey,
    sourceCommitment: "confirmed_withdrawal",
    tokenAccount: input.confirmedVaultIdleTokenAccount,
    updatedAt: observedAt,
    vaultId: resolution.vault.id,
  });
}

function assertDuplicateWithdrawalField<T extends string | bigint | number>(
  actual: T,
  expected: T,
  label: string
) {
  if (actual !== expected) {
    throw new Error(`Duplicate withdrawal ${label} metadata mismatch.`);
  }
}

function assertDuplicateDepositField<T extends string | bigint | number | null>(
  actual: T,
  expected: T,
  label: string
) {
  if (actual !== expected) {
    throw new Error(`Duplicate deposit ${label} metadata mismatch.`);
  }
}

function canonicalYieldSmartAccountAddress(input: {
  vaultPubkey: string;
}): string {
  return input.vaultPubkey;
}

function normalizeReserveWithdrawalsForCompare(
  value: YieldWithdrawalReserveMetadata[] | null | undefined
): string {
  const normalized = (value ?? []).map((withdrawal) => {
    const record = withdrawal as YieldWithdrawalReserveMetadata & {
      amountRaw?: string;
    };
    return {
      amountRaw:
        record.withdrawnAmountRaw ??
        record.amountRaw ??
        record.kaminoWithdrawAmountRaw,
      liquidityMint: record.liquidityMint,
      market: record.market,
      reserve: record.accountingReserve ?? record.reserve,
    };
  });
  normalized.sort((left, right) =>
    `${left.reserve}:${left.market ?? ""}:${left.liquidityMint}:${
      left.amountRaw
    }`.localeCompare(
      `${right.reserve}:${right.market ?? ""}:${right.liquidityMint}:${
        right.amountRaw
      }`
    )
  );
  return JSON.stringify(normalized);
}

function normalizeSourceMetadataForCompare(
  value: Record<string, unknown> | null | undefined
): string {
  const metadata = value ?? {};
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(metadata).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    )
  );
}

function normalizeWithdrawalSource(input: ConfirmedYieldWithdrawalInput): {
  sourceType: "reserve" | "idle";
  sourceId: string;
  sourceAmountRaw: bigint | null;
  sourceMetadata: Record<string, unknown>;
  sourceMint: string | null;
  sourceTokenAccount: string | null;
} {
  const sourceType = input.sourceType ?? "reserve";
  const sourceId =
    input.sourceId ??
    (sourceType === "idle"
      ? input.sourceTokenAccount ?? input.liquidityMint
      : input.accountingReserve ?? input.targetReserve);

  return {
    sourceAmountRaw: input.sourceAmountRaw ?? null,
    sourceId,
    sourceMetadata: input.sourceMetadata ?? {},
    sourceMint: input.sourceMint ?? null,
    sourceTokenAccount: input.sourceTokenAccount ?? null,
    sourceType,
  };
}

type NormalizedWithdrawalSource = ReturnType<typeof normalizeWithdrawalSource>;

function compactNonEmptyStrings(
  values: Array<string | null | undefined>
): string[] {
  const strings: string[] = [];
  for (const value of values) {
    if (value && !strings.includes(value)) {
      strings.push(value);
    }
  }
  return strings;
}

function getReserveWithdrawalSourceIds(
  source: NormalizedWithdrawalSource,
  input: ConfirmedYieldWithdrawalInput
): string[] {
  return compactNonEmptyStrings([
    source.sourceId,
    input.accountingReserve,
    input.targetReserve,
  ]);
}

function reserveRowMatchesWithdrawalSource(
  row: CurrentYieldVaultReservePositionRecord,
  source: NormalizedWithdrawalSource,
  input: ConfirmedYieldWithdrawalInput
): boolean {
  return getReserveWithdrawalSourceIds(source, input).includes(row.reserve);
}

function reserveRowsRepresentSameHolding(
  left: CurrentYieldVaultReservePositionRecord,
  right: CurrentYieldVaultReservePositionRecord
): boolean {
  return (
    left.reserve === right.reserve &&
    left.market === right.market &&
    left.liquidityMint === right.liquidityMint
  );
}

function asRedeemableLiquidityReserveRow(
  row: CurrentYieldVaultReservePositionRecord,
  amountRaw: bigint
): CurrentYieldVaultReservePositionRecord {
  return {
    ...row,
    amountRaw,
    hasValue: amountRaw > BigInt(0),
    planningMetadata: {
      ...row.planningMetadata,
      amountSemantics: "kamino_redeemable_liquidity",
      amount_semantics: "kamino_redeemable_liquidity",
    },
  };
}

function buildFallbackRedeemableReserveRow(args: {
  amountRaw: bigint;
  input: ConfirmedYieldWithdrawalInput;
  observedAt: Date;
  vaultId: bigint;
}): CurrentYieldVaultReservePositionRecord | null {
  const reserve = args.input.accountingReserve ?? args.input.targetReserve;
  if (!reserve || !args.input.liquidityMint) {
    return null;
  }

  return {
    amountRaw: args.amountRaw,
    borrowApyBps: null,
    hasValue: args.amountRaw > BigInt(0),
    liquidityMint: args.input.liquidityMint,
    market: args.input.market,
    observedAt: args.observedAt,
    observedSlot: args.input.confirmedSlot,
    planningMetadata: {
      amountSemantics: "kamino_redeemable_liquidity",
      amount_semantics: "kamino_redeemable_liquidity",
      source: "confirmed_withdrawal_transaction",
      withdrawalSignature: args.input.withdrawalSignature,
    },
    reserve,
    snapshotId: BigInt(0),
    supplyApyBps: null,
    vaultId: args.vaultId,
  };
}

function parseUnsignedBigInt(value: string | null | undefined): bigint | null {
  return typeof value === "string" && /^\d+$/.test(value)
    ? BigInt(value)
    : null;
}

function getPreparedReserveDebitAmountRaw(
  input: ConfirmedYieldWithdrawalInput
): bigint | null {
  if (!input.reserveWithdrawals || input.reserveWithdrawals.length === 0) {
    return null;
  }

  return input.reserveWithdrawals.reduce((total, withdrawal) => {
    const amountRaw = parseUnsignedBigInt(withdrawal.kaminoWithdrawAmountRaw);
    return amountRaw === null ? total : total + amountRaw;
  }, BigInt(0));
}

function getWithdrawalSourceDebitAmountRaw(
  input: ConfirmedYieldWithdrawalInput,
  sourceType: "reserve" | "idle"
): bigint {
  if (sourceType === "idle") {
    return input.withdrawnAmountRaw;
  }

  return (
    input.confirmedReserveDebitAmountRaw ??
    getPreparedReserveDebitAmountRaw(input) ??
    input.withdrawnAmountRaw
  );
}

function maxBigInt(values: bigint[]): bigint {
  return values.reduce(
    (largest, value) => (value > largest ? value : largest),
    BigInt(0)
  );
}

function readStoredWithdrawalSourceType(
  value: string | null
): "reserve" | "idle" | null {
  return value === "reserve" || value === "idle" ? value : null;
}

function readStoredWithdrawalSourceAmountRaw(
  withdrawal: UserYieldPositionWithdrawalRecord
): bigint | null {
  const amountRaw = withdrawal.sourceMetadata?.amountRaw;
  if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) {
    return null;
  }

  return BigInt(amountRaw);
}

function readStoredWithdrawalSourceMetadataString(
  withdrawal: UserYieldPositionWithdrawalRecord,
  key: string
): string | null {
  const value = withdrawal.sourceMetadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function buildIdempotentWithdrawalRepairInput(
  input: ConfirmedYieldWithdrawalInput,
  withdrawal: UserYieldPositionWithdrawalRecord
): ConfirmedYieldWithdrawalInput | null {
  const sourceAmountRaw =
    input.sourceAmountRaw ?? readStoredWithdrawalSourceAmountRaw(withdrawal);
  if (sourceAmountRaw === null) {
    return null;
  }

  const sourceType =
    input.sourceType ?? readStoredWithdrawalSourceType(withdrawal.sourceType);
  if (!sourceType) {
    return null;
  }

  return {
    ...input,
    sourceAmountRaw,
    sourceId: input.sourceId ?? withdrawal.sourceId,
    sourceMetadata: input.sourceMetadata ?? withdrawal.sourceMetadata ?? {},
    sourceMint:
      input.sourceMint ??
      readStoredWithdrawalSourceMetadataString(withdrawal, "mint"),
    sourceTokenAccount:
      input.sourceTokenAccount ??
      readStoredWithdrawalSourceMetadataString(withdrawal, "tokenAccount"),
    sourceType,
  };
}

function isIdempotentWithdrawalSourceAlreadyApplied(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "No active Earn vault exists for this withdrawal." ||
    error.message === "Withdrawal source does not match a reconciled reserve." ||
    error.message === "Withdrawal source does not match idle vault USDC." ||
    error.message === "Withdrawal source amount changed before confirmation." ||
    error.message === "Withdrawal exceeds the selected Earn source amount."
  );
}

async function repairCurrentVaultSourceWithdrawalForIdempotentRecord(args: {
  dependencies: YieldDepositRepositoryDependencies;
  input: ConfirmedYieldWithdrawalInput;
  withdrawal: UserYieldPositionWithdrawalRecord;
}): Promise<void> {
  const repairInput = buildIdempotentWithdrawalRepairInput(
    args.input,
    args.withdrawal
  );
  if (!repairInput) {
    return;
  }

  try {
    const resolution = await resolveWithdrawalSource(
      repairInput,
      args.dependencies
    );
    await recordCurrentVaultSourceWithdrawal({
      dependencies: args.dependencies,
      input: repairInput,
      resolution,
    });
  } catch (error) {
    if (isIdempotentWithdrawalSourceAlreadyApplied(error)) {
      return;
    }
    throw error;
  }
}

function buildStoredWithdrawalSourceMetadata(args: {
  sourceAmountRaw: bigint;
  sourceMetadata: Record<string, unknown>;
  sourceMint: string | null;
  sourceTokenAccount: string | null;
}): Record<string, unknown> {
  return {
    ...args.sourceMetadata,
    ...(args.sourceTokenAccount
      ? { tokenAccount: args.sourceTokenAccount }
      : {}),
    ...(args.sourceMint ? { mint: args.sourceMint } : {}),
    amountRaw: args.sourceAmountRaw.toString(),
  };
}

type WithdrawalSourceResolution = {
  idleRows: CurrentYieldVaultIdleTokenBalanceRecord[];
  isFinalExit: boolean;
  selectedIdleRow: CurrentYieldVaultIdleTokenBalanceRecord | null;
  selectedReserveRow: CurrentYieldVaultReservePositionRecord | null;
  remainingIdleAmountRaw: bigint;
  remainingReserveAmountRaw: bigint;
  sourceAmountRaw: bigint;
  sourceId: string;
  sourceMetadata: Record<string, unknown>;
  sourceMint: string | null;
  sourceTokenAccount: string | null;
  sourceType: "reserve" | "idle";
  vault: ManagedYieldVaultRecord;
  reserveRows: CurrentYieldVaultReservePositionRecord[];
};

async function resolveWithdrawalSource(
  input: ConfirmedYieldWithdrawalInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client" | "now">
): Promise<WithdrawalSourceResolution> {
  const source = normalizeWithdrawalSource(input);
  const sourceDebitAmountRaw = getWithdrawalSourceDebitAmountRaw(
    input,
    source.sourceType
  );
  const vault = await dependencies.client.db.query.managedVaults.findFirst({
    where: and(
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, input.vaultPubkey),
      eq(managedVaults.active, true)
    ),
  });
  if (!vault) {
    throw new Error("No active Earn vault exists for this withdrawal.");
  }

  const [reserveRows, idleRows] = await dependencies.client.db.batch([
    dependencies.client.db
      .select()
      .from(vaultReservePositionsCurrent)
      .where(eq(vaultReservePositionsCurrent.vaultId, vault.id)) as never,
    dependencies.client.db
      .select()
      .from(vaultIdleTokenBalancesCurrent)
      .where(eq(vaultIdleTokenBalancesCurrent.vaultId, vault.id)) as never,
  ]);
  const allReserveRows =
    reserveRows as CurrentYieldVaultReservePositionRecord[];
  const userFacingReserveRows =
    filterUserFacingYieldVaultReservePositions(allReserveRows);
  const currentReserveRows = userFacingReserveRows.filter(
    (row) => row.amountRaw > BigInt(0)
  );
  const currentIdleRows = (
    idleRows as CurrentYieldVaultIdleTokenBalanceRecord[]
  ).filter((row) => row.amountRaw > BigInt(0));
  const selectedCurrentReserveRow =
    source.sourceType === "reserve"
      ? currentReserveRows.find((row) =>
          reserveRowMatchesWithdrawalSource(row, source, input)
        ) ?? null
      : null;
  const selectedHistoricalReserveRow =
    source.sourceType === "reserve"
      ? userFacingReserveRows.find((row) =>
          reserveRowMatchesWithdrawalSource(row, source, input)
        ) ??
        allReserveRows.find((row) =>
          reserveRowMatchesWithdrawalSource(row, source, input)
        ) ?? null
      : null;
  const fallbackReserveAmountRaw =
    source.sourceType === "reserve"
      ? maxBigInt([
          sourceDebitAmountRaw,
          source.sourceAmountRaw ?? BigInt(0),
          selectedHistoricalReserveRow?.amountRaw ?? BigInt(0),
        ])
      : BigInt(0);
  const selectedReserveRow =
    source.sourceType !== "reserve"
      ? null
      : selectedCurrentReserveRow
      ? asRedeemableLiquidityReserveRow(
          selectedCurrentReserveRow,
          maxBigInt([
            selectedCurrentReserveRow.amountRaw,
            source.sourceAmountRaw ?? BigInt(0),
            sourceDebitAmountRaw,
          ])
        )
      : selectedHistoricalReserveRow && fallbackReserveAmountRaw > BigInt(0)
      ? asRedeemableLiquidityReserveRow(
          selectedHistoricalReserveRow,
          fallbackReserveAmountRaw
        )
      : fallbackReserveAmountRaw > BigInt(0)
      ? buildFallbackRedeemableReserveRow({
          amountRaw: fallbackReserveAmountRaw,
          input,
          observedAt: dependencies.now(),
          vaultId: vault.id,
        })
      : null;
  const reserveRowsForResolution =
    source.sourceType === "reserve" && selectedReserveRow
      ? [
          ...currentReserveRows.filter(
            (row) => !reserveRowsRepresentSameHolding(row, selectedReserveRow)
          ),
          selectedReserveRow,
        ]
      : currentReserveRows;
  const selectedIdleRow =
    source.sourceType === "idle"
      ? currentIdleRows.find(
          (row) =>
            row.tokenAccount === source.sourceId ||
            row.tokenAccount === source.sourceTokenAccount ||
            row.mint === source.sourceId ||
            row.mint === source.sourceMint
        ) ?? null
      : null;

  if (source.sourceType === "reserve" && !selectedReserveRow) {
    throw new Error("Withdrawal source does not match a reconciled reserve.");
  }
  if (source.sourceType === "idle" && !selectedIdleRow) {
    throw new Error("Withdrawal source does not match idle vault USDC.");
  }

  const sourceAmountRaw =
    source.sourceType === "reserve"
      ? selectedReserveRow!.amountRaw
      : selectedIdleRow!.amountRaw;
  if (sourceDebitAmountRaw > sourceAmountRaw) {
    throw new Error("Withdrawal exceeds the selected Earn source amount.");
  }

  const remainingReserveRaw = currentReserveRows.reduce((total, row) => {
    if (
      source.sourceType === "reserve" &&
      selectedReserveRow &&
      reserveRowsRepresentSameHolding(row, selectedReserveRow)
    ) {
      return (
        total +
        (selectedReserveRow.amountRaw > sourceDebitAmountRaw
          ? selectedReserveRow.amountRaw - sourceDebitAmountRaw
          : BigInt(0))
      );
    }
    return total + row.amountRaw;
  }, BigInt(0));
  const fallbackRemainingReserveRaw =
    source.sourceType === "reserve" &&
    selectedReserveRow &&
      !selectedCurrentReserveRow
      ? selectedReserveRow.amountRaw > sourceDebitAmountRaw
        ? selectedReserveRow.amountRaw - sourceDebitAmountRaw
        : BigInt(0)
      : BigInt(0);
  const remainingIdleRaw = currentIdleRows.reduce((total, row) => {
    if (
      source.sourceType === "idle" &&
      row.tokenAccount === selectedIdleRow!.tokenAccount
    ) {
      return (
        total +
        (row.amountRaw > input.withdrawnAmountRaw
          ? row.amountRaw - input.withdrawnAmountRaw
          : BigInt(0))
      );
    }
    return total + row.amountRaw;
  }, BigInt(0));
  const remainingReserveAmountRaw =
    remainingReserveRaw + fallbackRemainingReserveRaw;
  const reserveVaultIdleDeltaRaw =
    source.sourceType === "reserve" &&
    input.confirmedVaultIdleDeltaRaw !== undefined &&
    input.confirmedVaultIdleDeltaRaw !== null &&
    input.confirmedVaultIdleDeltaRaw > BigInt(0)
      ? input.confirmedVaultIdleDeltaRaw
      : BigInt(0);

  return {
    idleRows: currentIdleRows,
    // Mirrors the prepare routes' final-exit derivation (same dust tolerance):
    // a full-mode exit sweeps idle dust and closes the on-chain policies, so
    // the DB pair must be released here on the same basis.
    isFinalExit:
      input.mode === "full" &&
      remainingReserveAmountRaw <= BigInt(0) &&
      remainingIdleRaw < EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW,
    remainingIdleAmountRaw: remainingIdleRaw + reserveVaultIdleDeltaRaw,
    remainingReserveAmountRaw,
    selectedIdleRow,
    selectedReserveRow,
    sourceAmountRaw,
    sourceId: source.sourceId,
    sourceMetadata: source.sourceMetadata,
    sourceMint:
      source.sourceMint ??
      selectedIdleRow?.mint ??
      selectedReserveRow?.liquidityMint ??
      null,
    sourceTokenAccount:
      source.sourceTokenAccount ?? selectedIdleRow?.tokenAccount ?? null,
    sourceType: source.sourceType,
    vault,
    reserveRows: reserveRowsForResolution,
  };
}

async function resolveIdempotentDepositAccounting(
  input: ConfirmedYieldDepositInput,
  dependencies: YieldDepositRepositoryDependencies
): Promise<IdempotentDepositAccountingResult> {
  const deposit =
    await dependencies.client.db.query.userYieldPositionDeposits.findFirst({
      where: eq(
        userYieldPositionDeposits.depositSignature,
        input.depositSignature
      ),
    });
  if (!deposit) {
    return null;
  }

  assertDuplicateDepositField(
    deposit.confirmedSlot,
    input.confirmedSlot,
    "confirmedSlot"
  );
  assertDuplicateDepositField(
    deposit.walletAddress,
    input.walletAddress,
    "walletAddress"
  );
  assertDuplicateDepositField(
    deposit.smartAccountAddress,
    canonicalYieldSmartAccountAddress(input),
    "smartAccountAddress"
  );
  assertDuplicateDepositField(deposit.settings, input.settings, "settings");
  assertDuplicateDepositField(
    deposit.vaultIndex,
    input.vaultIndex,
    "vaultIndex"
  );
  assertDuplicateDepositField(
    deposit.vaultPubkey,
    input.vaultPubkey,
    "vaultPubkey"
  );
  assertDuplicateDepositField(deposit.policyId, input.policyId, "policyId");
  assertDuplicateDepositField(
    deposit.policyAccount,
    input.policyAccount,
    "policyAccount"
  );
  assertDuplicateDepositField(
    deposit.policySeed,
    input.policySeed,
    "policySeed"
  );
  assertDuplicateDepositField(
    deposit.policySignature,
    input.policySignature,
    "policySignature"
  );
  assertDuplicateDepositField(
    deposit.targetReserve,
    input.targetReserve,
    "targetReserve"
  );
  assertDuplicateDepositField(deposit.market, input.market, "market");
  assertDuplicateDepositField(
    deposit.liquidityMint,
    input.liquidityMint,
    "liquidityMint"
  );
  assertDuplicateDepositField(
    deposit.targetSupplyApyBps,
    input.targetSupplyApyBps,
    "targetSupplyApyBps"
  );
  assertDuplicateDepositField(
    deposit.depositMint,
    input.depositMint,
    "depositMint"
  );
  assertDuplicateDepositField(
    deposit.principalAmountRaw,
    input.principalAmountRaw,
    "principalAmountRaw"
  );

  const event =
    await dependencies.client.db.query.userYieldPositionHoldingEvents.findFirst(
      {
        orderBy: [
          desc(userYieldPositionHoldingEvents.observedSlot),
          desc(userYieldPositionHoldingEvents.id),
        ],
        where: eq(userYieldPositionHoldingEvents.sourceDepositId, deposit.id),
      }
    );
  if (event) {
    const position =
      await dependencies.client.db.query.userYieldPositions.findFirst({
        where: eq(userYieldPositions.id, event.positionId),
      });
    if (position) {
      if (
        position.status === "active" &&
        position.lastDepositSignature === input.depositSignature &&
        currentPositionMatchesHoldingEvent(position, event)
      ) {
        return { kind: "complete", position };
      }

      const shouldIncrementPrincipal =
        event.eventType === "deposit_top_up" &&
        position.lastDepositSignature !== input.depositSignature;
      const principalAmountRaw =
        event.eventType === "deposit_initialized"
          ? input.principalAmountRaw
          : shouldIncrementPrincipal
            ? sql`${userYieldPositions.principalAmountRaw} + ${input.principalAmountRaw}`
            : undefined;
      const repairedPosition = await applyHoldingEventToPosition({
        client: dependencies.client,
        event,
        lastConfirmedSlot: input.confirmedSlot,
        lastDepositSignature: input.depositSignature,
        now: dependencies.now(),
        principalAmountRaw,
        status: "active",
      });

      return { kind: "complete", position: repairedPosition };
    }
  }

  return { depositId: deposit.id, kind: "recover" };
}

async function findIdempotentWithdrawalPosition(
  input: ConfirmedYieldWithdrawalInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">
): Promise<{
  position: UserYieldPositionRecord;
  withdrawal: UserYieldPositionWithdrawalRecord;
} | null> {
  const withdrawal =
    await dependencies.client.db.query.userYieldPositionWithdrawals.findFirst({
      where: eq(
        userYieldPositionWithdrawals.withdrawalSignature,
        input.withdrawalSignature
      ),
    });
  if (!withdrawal) {
    return null;
  }

  assertDuplicateWithdrawalField(
    withdrawal.confirmedSlot,
    input.confirmedSlot,
    "confirmedSlot"
  );
  assertDuplicateWithdrawalField(
    withdrawal.walletAddress,
    input.walletAddress,
    "walletAddress"
  );
  assertDuplicateWithdrawalField(
    withdrawal.smartAccountAddress,
    canonicalYieldSmartAccountAddress(input),
    "smartAccountAddress"
  );
  assertDuplicateWithdrawalField(
    withdrawal.settings,
    input.settings,
    "settings"
  );
  assertDuplicateWithdrawalField(
    withdrawal.vaultIndex,
    input.vaultIndex,
    "vaultIndex"
  );
  assertDuplicateWithdrawalField(
    withdrawal.vaultPubkey,
    input.vaultPubkey,
    "vaultPubkey"
  );
  assertDuplicateWithdrawalField(
    withdrawal.policyId,
    input.policyId,
    "policyId"
  );
  assertDuplicateWithdrawalField(
    withdrawal.policyAccount,
    input.policyAccount,
    "policyAccount"
  );
  assertDuplicateWithdrawalField(
    withdrawal.policySeed,
    input.policySeed,
    "policySeed"
  );
  assertDuplicateWithdrawalField(
    withdrawal.targetReserve,
    input.targetReserve,
    "targetReserve"
  );
  assertDuplicateWithdrawalField(
    withdrawal.liquidityMint,
    input.liquidityMint,
    "liquidityMint"
  );
  assertDuplicateWithdrawalField(
    withdrawal.withdrawnAmountRaw,
    input.withdrawnAmountRaw,
    "withdrawnAmountRaw"
  );
  assertDuplicateWithdrawalField(withdrawal.mode, input.mode, "mode");
  if (withdrawal.market !== input.market) {
    throw new Error("Duplicate withdrawal market metadata mismatch.");
  }
  if (
    normalizeReserveWithdrawalsForCompare(withdrawal.reserveWithdrawals) !==
    normalizeReserveWithdrawalsForCompare(input.reserveWithdrawals)
  ) {
    throw new Error(
      "Duplicate withdrawal reserve withdrawal metadata mismatch."
    );
  }
  const hasStoredSourceMetadata =
    Boolean(withdrawal.sourceType) ||
    Boolean(withdrawal.sourceId) ||
    Object.keys(withdrawal.sourceMetadata ?? {}).length > 0;
  if (hasStoredSourceMetadata) {
    const source = normalizeWithdrawalSource(input);
    if ((withdrawal.sourceType ?? "reserve") !== source.sourceType) {
      throw new Error("Duplicate withdrawal sourceType metadata mismatch.");
    }
    if (
      (withdrawal.sourceId ??
        (source.sourceType === "reserve" ? withdrawal.targetReserve : null)) !==
      source.sourceId
    ) {
      throw new Error("Duplicate withdrawal sourceId metadata mismatch.");
    }
    if (
      normalizeSourceMetadataForCompare(withdrawal.sourceMetadata ?? {}) !==
      normalizeSourceMetadataForCompare(
        buildStoredWithdrawalSourceMetadata({
          sourceAmountRaw:
            source.sourceAmountRaw ??
            BigInt(
              typeof withdrawal.sourceMetadata?.amountRaw === "string"
                ? withdrawal.sourceMetadata.amountRaw
                : withdrawal.withdrawnAmountRaw
            ),
          sourceMetadata: source.sourceMetadata,
          sourceMint: source.sourceMint,
          sourceTokenAccount: source.sourceTokenAccount,
        })
      )
    ) {
      throw new Error("Duplicate withdrawal source metadata mismatch.");
    }
  }

  const position =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress),
        eq(userYieldPositions.vaultPubkey, input.vaultPubkey)
      ),
      orderBy: [
        desc(userYieldPositions.updatedAt),
        desc(userYieldPositions.id),
      ],
    });

  if (!position) {
    throw new Error("Duplicate withdrawal position is missing.");
  }

  return { position, withdrawal };
}

function createYieldRoutingPolicyPlanFromRouteInput(
  input: ConfirmedYieldRoutePolicyInput
): YieldRoutePolicyPlan<readonly []> {
  return createYieldRoutePolicyPlan({
    cluster: normalizeLoyalCluster(input.cluster),
    policySeed: input.policySeed,
    risk: RiskBasket.Safe,
    swapLanes: [] as const,
    squads: {
      settings: new PublicKey(input.settings),
      authority: new PublicKey(input.walletAddress),
      delegatedSigner: new PublicKey(input.delegatedSigner),
      accountIndex: input.vaultIndex,
      vault: new PublicKey(input.vaultPubkey),
    },
  });
}

function createYieldRoutingSetupPolicyPlanFromRouteInput(
  input: ConfirmedYieldRoutePolicyInput,
  setupPolicySeed: bigint
): YieldRouteSetupPolicyPlan {
  return createYieldRouteSetupPolicyPlan({
    cluster: normalizeLoyalCluster(input.cluster),
    policySeed: setupPolicySeed,
    risk: RiskBasket.Safe,
    squads: {
      settings: new PublicKey(input.settings),
      authority: new PublicKey(input.walletAddress),
      delegatedSigner: new PublicKey(input.delegatedSigner),
      accountIndex: input.vaultIndex,
      vault: new PublicKey(input.vaultPubkey),
    },
  });
}

type RoutePolicyValuesInput = Pick<
  ConfirmedYieldRoutePolicyInput,
  | "cluster"
  | "delegatedSigner"
  | "settings"
  | "vaultIndex"
  | "vaultPubkey"
  | "walletAddress"
> & {
  confirmedSlot: bigint;
  policyAccount: string;
  policySeed: bigint;
  policySignature: string;
};

type ConfirmedSetupPolicyMetadata = {
  confirmedSlot: bigint;
  policyAccount: string;
  policySeed: bigint;
  policySignature: string;
};

function getRoutePolicyConfirmedSlot(
  input: ConfirmedYieldRoutePolicyInput
): bigint {
  return input.policyConfirmedSlot ?? input.confirmedSlot;
}

function getConfirmedSetupPolicyMetadata(
  input: ConfirmedYieldRoutePolicyInput
): ConfirmedSetupPolicyMetadata | null {
  const hasSetupConfirmation =
    (input.setupPolicySignature !== undefined &&
      input.setupPolicySignature !== null) ||
    (input.setupPolicyConfirmedSlot !== undefined &&
      input.setupPolicyConfirmedSlot !== null);

  if (!hasSetupConfirmation) {
    return null;
  }

  if (
    !input.setupPolicyAccount ||
    input.setupPolicySeed === undefined ||
    input.setupPolicySeed === null ||
    !input.setupPolicySignature ||
    input.setupPolicyConfirmedSlot === undefined ||
    input.setupPolicyConfirmedSlot === null
  ) {
    throw new Error("Confirmed setup policy metadata is incomplete.");
  }

  if (
    input.setupPolicyId !== undefined &&
    input.setupPolicyId !== null &&
    input.setupPolicyId !== input.setupPolicySeed
  ) {
    throw new Error("Confirmed setup policy id must match setup policy seed.");
  }

  return {
    confirmedSlot: input.setupPolicyConfirmedSlot,
    policyAccount: input.setupPolicyAccount,
    policySeed: input.setupPolicySeed,
    policySignature: input.setupPolicySignature,
  };
}

export function createRoutePolicyValuesFromPlan(
  plan: YieldRoutePolicyPlan | YieldRouteSetupPolicyPlan,
  input: RoutePolicyValuesInput,
  now: Date
) {
  return {
    active: true,
    authority: input.walletAddress,
    delegatedSigners: [input.delegatedSigner],
    firstSeenAt: now,
    kaminoLiquidityMints: plan.persistence.kaminoLiquidityMints,
    kaminoMarkets: plan.persistence.kaminoMarkets,
    lastSeenAt: now,
    lastSeenSignature: input.policySignature,
    lastSeenSlot: input.confirmedSlot,
    policyAccount: input.policyAccount,
    policySeed: input.policySeed,
    riskProfile: plan.persistence.riskProfile,
    routeModes: plan.persistence.routeModes,
    settings: input.settings,
    stableMints: plan.persistence.stableMints,
    swapLanes: plan.persistence.swapLanes,
    threshold: plan.persistence.threshold,
    universePreset: plan.persistence.universePreset,
    vaultIndex: plan.metadata.vaultIndex,
    vaultPubkey: plan.metadata.vault.toBase58(),
  };
}

async function upsertConfirmedYieldRoutePolicy(args: {
  client: YieldOptimizationClient;
  input: ConfirmedYieldRoutePolicyInput;
  now: Date;
}): Promise<{
  routePolicy: RoutePolicyRecord;
  setupPolicy: RoutePolicyRecord | null;
}> {
  const { client, input, now } = args;
  const routePolicyPlan = createYieldRoutingPolicyPlanFromRouteInput(input);
  const routePolicyInput = {
    ...input,
    confirmedSlot: getRoutePolicyConfirmedSlot(input),
  };
  const routePolicyValues = createRoutePolicyValuesFromPlan(
    routePolicyPlan,
    routePolicyInput,
    now
  );
  const setupPolicyMetadata = getConfirmedSetupPolicyMetadata(input);
  const [routePolicy] = await client.db
    .insert(routePolicies)
    .values(routePolicyValues)
    .onConflictDoUpdate({
      target: [routePolicies.policyAccount],
      set: {
        active: true,
        authority: sql`excluded.authority`,
        delegatedSigners: sql`excluded.delegated_signers`,
        kaminoLiquidityMints: sql`excluded.kamino_liquidity_mints`,
        kaminoMarkets: sql`excluded.kamino_markets`,
        lastSeenAt: now,
        lastSeenSignature: input.policySignature,
        lastSeenSlot: routePolicyInput.confirmedSlot,
        policySeed: input.policySeed,
        riskProfile: sql`excluded.risk_profile`,
        routeModes: sql`excluded.route_modes`,
        stableMints: sql`excluded.stable_mints`,
        swapLanes: sql`excluded.swap_lanes`,
        threshold: sql`excluded.threshold`,
        universePreset: sql`excluded.universe_preset`,
        vaultIndex: routePolicyValues.vaultIndex,
        vaultPubkey: routePolicyValues.vaultPubkey,
      },
    })
    .returning();

  if (!routePolicy) {
    throw new Error("Failed to record confirmed yield route policy.");
  }

  let setupPolicy: RoutePolicyRecord | null = null;
  if (setupPolicyMetadata) {
    const setupPolicyPlan = createYieldRoutingSetupPolicyPlanFromRouteInput(
      input,
      setupPolicyMetadata.policySeed
    );
    const setupPolicyValues = createRoutePolicyValuesFromPlan(
      setupPolicyPlan,
      {
        ...input,
        confirmedSlot: setupPolicyMetadata.confirmedSlot,
        policyAccount: setupPolicyMetadata.policyAccount,
        policySeed: setupPolicyMetadata.policySeed,
        policySignature: setupPolicyMetadata.policySignature,
      },
      now
    );
    const [record] = await client.db
      .insert(routePolicies)
      .values(setupPolicyValues)
      .onConflictDoUpdate({
        target: [routePolicies.policyAccount],
        set: {
          active: true,
          authority: sql`excluded.authority`,
          delegatedSigners: sql`excluded.delegated_signers`,
          kaminoLiquidityMints: sql`excluded.kamino_liquidity_mints`,
          kaminoMarkets: sql`excluded.kamino_markets`,
          lastSeenAt: now,
          lastSeenSignature: setupPolicyMetadata.policySignature,
          lastSeenSlot: setupPolicyMetadata.confirmedSlot,
          policySeed: setupPolicyMetadata.policySeed,
          riskProfile: sql`excluded.risk_profile`,
          routeModes: sql`excluded.route_modes`,
          stableMints: sql`excluded.stable_mints`,
          swapLanes: sql`excluded.swap_lanes`,
          threshold: sql`excluded.threshold`,
          universePreset: sql`excluded.universe_preset`,
          vaultIndex: setupPolicyValues.vaultIndex,
          vaultPubkey: setupPolicyValues.vaultPubkey,
        },
      })
      .returning();

    if (!record) {
      throw new Error("Failed to record confirmed yield setup policy.");
    }
    setupPolicy = record;
  }

  if (setupPolicy) {
    const managedVaultValues = {
      active: true,
      activePolicyId: routePolicy.id,
      firstSeenAt: now,
      lastSeenAt: now,
      settings: input.settings,
      setupPolicyId: setupPolicy.id,
      vaultIndex: routePolicyPlan.metadata.vaultIndex,
      vaultPubkey: routePolicyPlan.metadata.vault.toBase58(),
    };
    await client.db
      .insert(managedVaults)
      .values(managedVaultValues)
      .onConflictDoUpdate({
        target: [
          managedVaults.settings,
          managedVaults.vaultIndex,
          managedVaults.vaultPubkey,
        ],
        set: {
          active: true,
          activePolicyId: routePolicy.id,
          lastSeenAt: now,
          setupPolicyId: setupPolicy.id,
        },
      });
  }

  return { routePolicy, setupPolicy };
}

async function upsertEarnDepositOnboardingAttempt(args: {
  client: YieldOptimizationClient;
  input: ConfirmedYieldRoutePolicyInput | ConfirmedYieldDepositInput;
  now: Date;
  routePolicyDbId?: bigint | null;
  setupPolicyDbId?: bigint | null;
  status: EarnDepositOnboardingStatus;
  lastErrorCode?: string | null;
}): Promise<EarnDepositOnboardingAttemptRecord> {
  const { client, input, now } = args;
  const values = {
    delegatedSigner: input.delegatedSigner,
    firstSeenAt: now,
    lastErrorCode: args.lastErrorCode ?? null,
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyId: input.policyId,
    policySeed: input.policySeed,
    routePolicyConfirmedSlot:
      "policyConfirmedSlot" in input
        ? input.policyConfirmedSlot ?? input.confirmedSlot
        : input.confirmedSlot,
    routePolicyDbId: args.routePolicyDbId ?? null,
    routePolicySignature: input.policySignature,
    settings: input.settings,
    setupPolicyAccount: input.setupPolicyAccount ?? null,
    setupPolicyConfirmedSlot: input.setupPolicyConfirmedSlot ?? null,
    setupPolicyDbId: args.setupPolicyDbId ?? null,
    setupPolicyId: input.setupPolicyId ?? null,
    setupPolicySeed: input.setupPolicySeed ?? null,
    setupPolicySignature: input.setupPolicySignature ?? null,
    smartAccountAddress:
      "smartAccountAddress" in input ? input.smartAccountAddress : null,
    status: args.status,
    targetReserve: input.targetReserve,
    targetSupplyApyBps:
      "targetSupplyApyBps" in input ? input.targetSupplyApyBps : null,
    updatedAt: now,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
    ...("depositSignature" in input
      ? {
          depositConfirmedSlot: input.confirmedSlot,
          depositMint: input.depositMint,
          depositSignature: input.depositSignature,
          principalAmountRaw: input.principalAmountRaw,
        }
      : {}),
  };

  const [attempt] = await client.db
    .insert(earnDepositOnboardingAttempts)
    .values(values)
    .onConflictDoUpdate({
      target: [
        earnDepositOnboardingAttempts.settings,
        earnDepositOnboardingAttempts.vaultIndex,
        earnDepositOnboardingAttempts.vaultPubkey,
      ],
      targetWhere: sql`${earnDepositOnboardingAttempts.status} <> 'complete'`,
      set: {
        delegatedSigner: input.delegatedSigner,
        lastErrorCode: args.lastErrorCode ?? null,
        liquidityMint: input.liquidityMint,
        market: input.market,
        policyAccount: input.policyAccount,
        policyId: input.policyId,
        policySeed: input.policySeed,
        routePolicyConfirmedSlot:
          "policyConfirmedSlot" in input
            ? input.policyConfirmedSlot ?? input.confirmedSlot
            : input.confirmedSlot,
        routePolicyDbId:
          args.routePolicyDbId ??
          sql`${earnDepositOnboardingAttempts.routePolicyDbId}`,
        routePolicySignature: input.policySignature,
        setupPolicyAccount:
          input.setupPolicyAccount ??
          sql`${earnDepositOnboardingAttempts.setupPolicyAccount}`,
        setupPolicyConfirmedSlot:
          input.setupPolicyConfirmedSlot ??
          sql`${earnDepositOnboardingAttempts.setupPolicyConfirmedSlot}`,
        setupPolicyDbId:
          args.setupPolicyDbId ??
          sql`${earnDepositOnboardingAttempts.setupPolicyDbId}`,
        setupPolicyId:
          input.setupPolicyId ??
          sql`${earnDepositOnboardingAttempts.setupPolicyId}`,
        setupPolicySeed:
          input.setupPolicySeed ??
          sql`${earnDepositOnboardingAttempts.setupPolicySeed}`,
        setupPolicySignature:
          input.setupPolicySignature ??
          sql`${earnDepositOnboardingAttempts.setupPolicySignature}`,
        smartAccountAddress:
          "smartAccountAddress" in input
            ? input.smartAccountAddress
            : sql`${earnDepositOnboardingAttempts.smartAccountAddress}`,
        status: args.status,
        targetReserve: input.targetReserve,
        targetSupplyApyBps:
          "targetSupplyApyBps" in input
            ? input.targetSupplyApyBps
            : sql`${earnDepositOnboardingAttempts.targetSupplyApyBps}`,
        updatedAt: now,
        walletAddress: input.walletAddress,
        ...("depositSignature" in input
          ? {
              depositConfirmedSlot: input.confirmedSlot,
              depositMint: input.depositMint,
              depositSignature: input.depositSignature,
              principalAmountRaw: input.principalAmountRaw,
            }
          : {}),
      },
    })
    .returning();

  if (!attempt) {
    throw new Error("Failed to record Earn deposit onboarding progress.");
  }

  return attempt as EarnDepositOnboardingAttemptRecord;
}

async function upsertAggregatePosition(args: {
  client: YieldOptimizationClient;
  input: ConfirmedYieldDepositInput;
  mode: AggregatePositionUpsertMode;
  now: Date;
}): Promise<UserYieldPositionRecord> {
  const { client, input, mode, now } = args;
  const smartAccountAddress = canonicalYieldSmartAccountAddress(input);
  const principalAmountRaw =
    mode === "increment-principal"
      ? sql`${userYieldPositions.principalAmountRaw} + ${input.principalAmountRaw}`
      : input.principalAmountRaw;
  const firstDepositSignature =
    mode === "increment-principal"
      ? userYieldPositions.firstDepositSignature
      : input.depositSignature;

  const [position] = await client.db
    .insert(userYieldPositions)
    .values({
      createdAt: now,
      depositMint: input.depositMint,
      firstDepositSignature: input.depositSignature,
      currentAmountRaw: input.principalAmountRaw,
      currentLiquidityMint: input.liquidityMint,
      currentMarket: input.market,
      currentObservedAt: now,
      currentObservedSlot: input.confirmedSlot,
      currentReserve: input.targetReserve,
      lastConfirmedSlot: input.confirmedSlot,
      lastDepositSignature: input.depositSignature,
      initialLiquidityMint: input.liquidityMint,
      initialMarket: input.market,
      policyAccount: input.policyAccount,
      policyId: input.policyId,
      policySeed: input.policySeed,
      principalAmountRaw: input.principalAmountRaw,
      settings: input.settings,
      smartAccountAddress,
      status: "active",
      initialReserve: input.targetReserve,
      initialSupplyApyBps: input.targetSupplyApyBps,
      updatedAt: now,
      vaultIndex: input.vaultIndex,
      vaultPubkey: input.vaultPubkey,
      walletAddress: input.walletAddress,
    })
    .onConflictDoUpdate({
      target: [
        userYieldPositions.settings,
        userYieldPositions.vaultIndex,
        userYieldPositions.initialReserve,
      ],
      set: {
        depositMint: input.depositMint,
        firstDepositSignature,
        initialLiquidityMint: input.liquidityMint,
        initialMarket: input.market,
        lastConfirmedSlot: input.confirmedSlot,
        lastDepositSignature: input.depositSignature,
        policyAccount: input.policyAccount,
        policyId: input.policyId,
        policySeed: input.policySeed,
        principalAmountRaw,
        smartAccountAddress,
        status: "active",
        initialSupplyApyBps: input.targetSupplyApyBps,
        updatedAt: now,
        vaultPubkey: input.vaultPubkey,
        walletAddress: input.walletAddress,
      },
    })
    .returning();

  if (!position) {
    throw new Error("Failed to record confirmed yield position.");
  }

  return position;
}

async function insertHoldingEvent(args: {
  client: YieldOptimizationClient;
  positionId: bigint;
  eventType:
    | "deposit_initialized"
    | "deposit_top_up"
    | "withdrawal_partial"
    | "withdrawal_full"
    | "rebalance_confirmed"
    | "snapshot_reconciled";
  reserve: string;
  market: string | null;
  liquidityMint: string;
  amountRaw: bigint;
  principalDeltaRaw: bigint | null;
  holdingDeltaRaw: bigint | null;
  observedSlot: bigint;
  observedAt: Date;
  sourceSignature: string | null;
  sourceDepositId?: bigint | null;
  sourceWithdrawalId?: bigint | null;
  sourceRebalanceDecisionId?: bigint | null;
  sourceSnapshotId?: bigint | null;
  createdAt: Date;
}): Promise<UserYieldPositionHoldingEventRecord> {
  const [event] = await args.client.db
    .insert(userYieldPositionHoldingEvents)
    .values({
      amountRaw: args.amountRaw,
      createdAt: args.createdAt,
      eventType: args.eventType,
      holdingDeltaRaw: args.holdingDeltaRaw,
      liquidityMint: args.liquidityMint,
      market: args.market,
      observedAt: args.observedAt,
      observedSlot: args.observedSlot,
      positionId: args.positionId,
      principalDeltaRaw: args.principalDeltaRaw,
      reserve: args.reserve,
      sourceDepositId: args.sourceDepositId ?? null,
      sourceRebalanceDecisionId: args.sourceRebalanceDecisionId ?? null,
      sourceSignature: args.sourceSignature,
      sourceSnapshotId: args.sourceSnapshotId ?? null,
      sourceWithdrawalId: args.sourceWithdrawalId ?? null,
    })
    .returning();

  if (!event) {
    throw new Error("Failed to record yield holding event.");
  }

  return event;
}

async function insertIdempotentRebalanceHoldingEvent(args: {
  amountRaw: bigint;
  client: YieldOptimizationClient;
  createdAt: Date;
  liquidityMint: string;
  market: string | null;
  observedAt: Date;
  observedSlot: bigint;
  positionId: bigint;
  reserve: string;
  sourceRebalanceDecisionId: bigint;
  sourceSignature: string;
  sourceSnapshotId: bigint;
}): Promise<UserYieldPositionHoldingEventRecord> {
  const [event] = await args.client.db
    .insert(userYieldPositionHoldingEvents)
    .values({
      amountRaw: args.amountRaw,
      createdAt: args.createdAt,
      eventType: "rebalance_confirmed",
      holdingDeltaRaw: null,
      liquidityMint: args.liquidityMint,
      market: args.market,
      observedAt: args.observedAt,
      observedSlot: args.observedSlot,
      positionId: args.positionId,
      principalDeltaRaw: null,
      reserve: args.reserve,
      sourceDepositId: null,
      sourceRebalanceDecisionId: args.sourceRebalanceDecisionId,
      sourceSignature: args.sourceSignature,
      sourceSnapshotId: args.sourceSnapshotId,
      sourceWithdrawalId: null,
    })
    .onConflictDoNothing()
    .returning();

  if (event) {
    return event as UserYieldPositionHoldingEventRecord;
  }

  const [existingEvent] = await args.client.db
    .select()
    .from(userYieldPositionHoldingEvents)
    .where(
      eq(
        userYieldPositionHoldingEvents.sourceRebalanceDecisionId,
        args.sourceRebalanceDecisionId
      )
    )
    .limit(1);

  if (!existingEvent) {
    throw new Error("Failed to record idempotent yield rebalance event.");
  }

  return existingEvent as UserYieldPositionHoldingEventRecord;
}

async function applyHoldingEventToPosition(args: {
  client: YieldOptimizationClient;
  event: UserYieldPositionHoldingEventRecord;
  principalAmountRaw?: unknown;
  lastConfirmedSlot?: bigint;
  status?: "active" | "closed";
  lastDepositSignature?: string;
  lastRebalanceDecisionId?: bigint;
  now: Date;
}): Promise<UserYieldPositionRecord> {
  const setValues: Record<string, unknown> = {
    currentAmountRaw: args.event.amountRaw,
    currentLiquidityMint: args.event.liquidityMint,
    currentMarket: args.event.market,
    currentObservedAt: args.event.observedAt,
    currentObservedSlot: args.event.observedSlot,
    currentReserve: args.event.reserve,
    lastHoldingEventId: args.event.id,
    updatedAt: args.now,
  };

  if (args.principalAmountRaw !== undefined) {
    setValues.principalAmountRaw = args.principalAmountRaw;
  }
  if (args.lastConfirmedSlot !== undefined) {
    setValues.lastConfirmedSlot = args.lastConfirmedSlot;
  }
  if (args.status !== undefined) {
    setValues.status = args.status;
  }
  if (args.lastDepositSignature !== undefined) {
    setValues.lastDepositSignature = args.lastDepositSignature;
  }
  if (args.lastRebalanceDecisionId !== undefined) {
    setValues.lastRebalanceDecisionId = args.lastRebalanceDecisionId;
  }

  const [position] = await args.client.db
    .update(userYieldPositions)
    .set(setValues)
    .where(eq(userYieldPositions.id, args.event.positionId))
    .returning();

  if (!position) {
    throw new Error("Failed to apply yield holding event.");
  }

  return position;
}

function holdingEventIsAtOrAfterCurrentPosition(
  position: UserYieldPositionRecord,
  event: UserYieldPositionHoldingEventRecord
): boolean {
  if (event.observedSlot !== position.currentObservedSlot) {
    return event.observedSlot > position.currentObservedSlot;
  }

  return event.observedAt.getTime() >= position.currentObservedAt.getTime();
}

async function applyRebalanceHoldingEventToPosition(args: {
  client: YieldOptimizationClient;
  event: UserYieldPositionHoldingEventRecord;
  lastRebalanceDecisionId: bigint;
  now: Date;
}): Promise<UserYieldPositionRecord> {
  const [position] = await args.client.db
    .select()
    .from(userYieldPositions)
    .where(eq(userYieldPositions.id, args.event.positionId))
    .limit(1);

  if (!position) {
    throw new Error("Failed to find yield position for rebalance event.");
  }

  if (
    holdingEventIsAtOrAfterCurrentPosition(
      position as UserYieldPositionRecord,
      args.event
    )
  ) {
    return applyHoldingEventToPosition({
      client: args.client,
      event: args.event,
      lastRebalanceDecisionId: args.lastRebalanceDecisionId,
      now: args.now,
    });
  }

  const [updatedPosition] = await args.client.db
    .update(userYieldPositions)
    .set({
      lastRebalanceDecisionId: sql`GREATEST(COALESCE(${userYieldPositions.lastRebalanceDecisionId}, 0::bigint), ${args.lastRebalanceDecisionId})`,
      updatedAt: args.now,
    })
    .where(eq(userYieldPositions.id, args.event.positionId))
    .returning();

  if (!updatedPosition) {
    throw new Error("Failed to apply yield rebalance decision.");
  }

  return updatedPosition as UserYieldPositionRecord;
}

export async function recordConfirmedYieldDeposit(
  input: ConfirmedYieldDepositInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<UserYieldPositionRecord> {
  if (
    input.policyInitialization !== "create" &&
    input.policyInitialization !== "reuse"
  ) {
    throw new Error("Deposit policy initialization must be create or reuse.");
  }

  const idempotentDepositAccounting = await resolveIdempotentDepositAccounting(
    input,
    dependencies
  );
  if (idempotentDepositAccounting?.kind === "complete") {
    return idempotentDepositAccounting.position;
  }
  const recoverDepositId =
    idempotentDepositAccounting?.kind === "recover"
      ? idempotentDepositAccounting.depositId
      : null;

  const { client } = dependencies;
  const now = dependencies.now();
  let activeVaultPosition = await findReconciledActiveYieldPositionForVault(
    {
      cluster: input.cluster,
      settings: input.settings,
      skipCurrentRowsObservedAtOrAfterSlot: input.confirmedSlot,
      vaultIndex: input.vaultIndex,
      walletAddress: input.walletAddress,
    },
    dependencies
  );
  let reservePosition =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.initialReserve, input.targetReserve),
        eq(userYieldPositions.walletAddress, input.walletAddress)
      ),
      orderBy: [desc(userYieldPositions.id)],
    });
  if (
    // A zero-balance refill with an active Earn policy prepares as "reuse".
    // This repair is only for stale aggregate rows left behind after cleanup,
    // where the next real first deposit has already created fresh policies.
    input.policyInitialization === "create" &&
    activeVaultPosition?.status === "active" &&
    activeVaultPosition.currentAmountRaw === BigInt(0) &&
    activeVaultPosition.principalAmountRaw === BigInt(0)
  ) {
    await client.db
      .update(userYieldPositions)
      .set({
        currentObservedAt: now,
        currentObservedSlot: input.confirmedSlot,
        lastConfirmedSlot: input.confirmedSlot,
        status: "closed",
        updatedAt: now,
      })
      .where(eq(userYieldPositions.id, activeVaultPosition.id));

    activeVaultPosition = {
      ...activeVaultPosition,
      currentObservedAt: now,
      currentObservedSlot: input.confirmedSlot,
      lastConfirmedSlot: input.confirmedSlot,
      status: "closed",
      updatedAt: now,
    };
    if (reservePosition?.id === activeVaultPosition.id) {
      reservePosition = activeVaultPosition;
    }
  }
  const existingPosition =
    input.policyInitialization === "reuse"
      ? activeVaultPosition ?? reservePosition
      : reservePosition;
  const activeCreateConflict =
    input.policyInitialization === "create" ? activeVaultPosition : null;

  const isDuplicateInitialDeposit =
    existingPosition?.firstDepositSignature === input.depositSignature ||
    existingPosition?.lastDepositSignature === input.depositSignature;
  if (
    input.policyInitialization === "create" &&
    activeCreateConflict?.status === "active" &&
    !isDuplicateInitialDeposit
  ) {
    throw new Error(
      "Initial yield deposit cannot recreate an active Earn policy."
    );
  }
  const hasActiveExistingPosition = existingPosition?.status === "active";

  await upsertConfirmedYieldRoutePolicy({
    client,
    input,
    now,
  });
  const smartAccountAddress = canonicalYieldSmartAccountAddress(input);
  const depositValues = {
    confirmedAt: now,
    confirmedSlot: input.confirmedSlot,
    createdAt: now,
    depositMint: input.depositMint,
    depositSignature: input.depositSignature,
    liquidityMint: input.liquidityMint,
    market: input.market,
    policyAccount: input.policyAccount,
    policyId: input.policyId,
    policySeed: input.policySeed,
    policySignature: input.policySignature,
    principalAmountRaw: input.principalAmountRaw,
    settings: input.settings,
    smartAccountAddress,
    targetReserve: input.targetReserve,
    targetSupplyApyBps: input.targetSupplyApyBps,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };

  const insertedDeposits =
    recoverDepositId === null
      ? await client.db
          .insert(userYieldPositionDeposits)
          .values(depositValues)
          .onConflictDoNothing({
            target: [userYieldPositionDeposits.depositSignature],
          })
          .returning({ id: userYieldPositionDeposits.id })
      : [];
  let depositId: bigint | null =
    recoverDepositId ?? insertedDeposits[0]?.id ?? null;
  if (depositId === null && recoverDepositId === null) {
    const replayedDepositAccounting = await resolveIdempotentDepositAccounting(
      input,
      dependencies
    );
    if (replayedDepositAccounting?.kind === "complete") {
      return replayedDepositAccounting.position;
    }
    depositId =
      replayedDepositAccounting?.kind === "recover"
        ? replayedDepositAccounting.depositId
        : null;
  }

  if (depositId !== null) {
    const shouldTreatAsTopUp =
      input.policyInitialization === "reuse" &&
      hasActiveExistingPosition &&
      existingPosition !== null &&
      existingPosition !== undefined;
    const position =
      shouldTreatAsTopUp
        ? existingPosition
        : await upsertAggregatePosition({
            client,
            input,
            mode: "recover-principal",
            now,
          });
    const sameCurrentHolding =
      !shouldTreatAsTopUp ||
      (existingPosition.currentReserve === input.targetReserve &&
        existingPosition.currentMarket === input.market &&
        existingPosition.currentLiquidityMint === input.liquidityMint);
    const nextCurrentAmountRaw = shouldTreatAsTopUp
      ? sameCurrentHolding
        ? existingPosition.currentAmountRaw + input.principalAmountRaw
        : input.principalAmountRaw
      : input.principalAmountRaw;
    const event = await insertHoldingEvent({
      amountRaw: nextCurrentAmountRaw,
      client,
      createdAt: now,
      eventType: shouldTreatAsTopUp
        ? "deposit_top_up"
        : "deposit_initialized",
      holdingDeltaRaw: input.principalAmountRaw,
      liquidityMint:
        shouldTreatAsTopUp && sameCurrentHolding
          ? existingPosition.currentLiquidityMint
          : input.liquidityMint,
      market:
        shouldTreatAsTopUp && sameCurrentHolding
          ? existingPosition.currentMarket
          : input.market,
      observedAt: now,
      observedSlot: input.confirmedSlot,
      positionId: position.id,
      principalDeltaRaw: input.principalAmountRaw,
      reserve:
        shouldTreatAsTopUp && sameCurrentHolding
          ? existingPosition.currentReserve
          : input.targetReserve,
      sourceDepositId: depositId,
      sourceSignature: input.depositSignature,
    });

    return applyHoldingEventToPosition({
      client,
      event,
      lastConfirmedSlot: input.confirmedSlot,
      lastDepositSignature: input.depositSignature,
      now,
      principalAmountRaw: shouldTreatAsTopUp
        ? sql`${userYieldPositions.principalAmountRaw} + ${input.principalAmountRaw}`
        : position.principalAmountRaw,
      status: "active",
    });
  }

  if (!existingPosition) {
    return upsertAggregatePosition({
      client,
      input,
      mode: "recover-principal",
      now,
    });
  }

  return existingPosition;
}

export async function recordConfirmedYieldRoutePolicy(
  input: ConfirmedYieldRoutePolicyInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<RoutePolicyRecord> {
  const { client } = dependencies;
  const now = dependencies.now();

  const { routePolicy } = await upsertConfirmedYieldRoutePolicy({
    client,
    input,
    now,
  });

  return routePolicy;
}

export async function recordConfirmedEarnDepositOnboardingPolicyStage(
  input: ConfirmedYieldRoutePolicyInput,
  stage: "route_policy" | "setup_policy",
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<RoutePolicyRecord> {
  const { client } = dependencies;
  const now = dependencies.now();
  const { routePolicy, setupPolicy } = await upsertConfirmedYieldRoutePolicy({
    client,
    input,
    now,
  });

  await upsertEarnDepositOnboardingAttempt({
    client,
    input,
    now,
    routePolicyDbId: routePolicy.id,
    setupPolicyDbId: setupPolicy?.id ?? null,
    status:
      stage === "setup_policy"
        ? "setup_policy_confirmed"
        : "route_policy_confirmed",
  });

  return routePolicy;
}

export async function recordEarnDepositOnboardingDepositSignature(
  input: ConfirmedYieldDepositInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<EarnDepositOnboardingAttemptRecord> {
  const { client } = dependencies;
  const now = dependencies.now();
  const pair = await findActiveYieldRoutePolicyPair(
    {
      authority: input.walletAddress,
      cluster: input.cluster,
      settings: input.settings,
      vaultIndex: input.vaultIndex,
      vaultPubkey: input.vaultPubkey,
    },
    dependencies
  );

  return upsertEarnDepositOnboardingAttempt({
    client,
    input,
    now,
    routePolicyDbId: pair?.routePolicy.id ?? null,
    setupPolicyDbId: pair?.setupPolicy?.id ?? null,
    status: "deposit_confirmed",
  });
}

export async function markEarnDepositOnboardingAccountingFailed(
  input: Pick<
    ConfirmedYieldDepositInput,
    "settings" | "vaultIndex" | "vaultPubkey"
  >,
  errorCode: string,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<void> {
  await dependencies.client.db
    .update(earnDepositOnboardingAttempts)
    .set({
      lastErrorCode: errorCode,
      status: "accounting_failed",
      updatedAt: dependencies.now(),
    })
    .where(
      and(
        eq(earnDepositOnboardingAttempts.settings, input.settings),
        eq(earnDepositOnboardingAttempts.vaultIndex, input.vaultIndex),
        eq(earnDepositOnboardingAttempts.vaultPubkey, input.vaultPubkey)
      )
    );
}

export async function markEarnDepositOnboardingComplete(
  input: Pick<
    ConfirmedYieldDepositInput,
    "settings" | "vaultIndex" | "vaultPubkey"
  >,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<void> {
  await dependencies.client.db
    .update(earnDepositOnboardingAttempts)
    .set({
      lastErrorCode: null,
      status: "complete",
      updatedAt: dependencies.now(),
    })
    .where(
      and(
        eq(earnDepositOnboardingAttempts.settings, input.settings),
        eq(earnDepositOnboardingAttempts.vaultIndex, input.vaultIndex),
        eq(earnDepositOnboardingAttempts.vaultPubkey, input.vaultPubkey)
      )
    );
}

export async function findActiveYieldPosition(
  input: ActiveYieldPositionLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionRecord | null> {
  const position =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.initialReserve, input.initialReserve),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress),
        eq(userYieldPositions.status, "active")
      ),
    });

  return position ?? null;
}

export async function findYieldPosition(
  input: ActiveYieldPositionLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionRecord | null> {
  const position =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.initialReserve, input.initialReserve),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress)
      ),
      orderBy: [
        desc(userYieldPositions.updatedAt),
        desc(userYieldPositions.id),
      ],
    });

  return position ?? null;
}

export async function findActiveYieldPositionForVault(
  input: ActiveYieldPositionForVaultLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionRecord | null> {
  const position =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress),
        eq(userYieldPositions.status, "active")
      ),
      orderBy: [
        desc(userYieldPositions.updatedAt),
        desc(userYieldPositions.id),
      ],
    });

  return position ?? null;
}

export async function findReconciledActiveYieldPositionForVault(
  input: ReconciledActiveYieldPositionForVaultLookupInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<UserYieldPositionRecord | null> {
  const position = await findActiveYieldPositionForVault(input, dependencies);
  if (!position) {
    return null;
  }

  const vault = await dependencies.client.db.query.managedVaults.findFirst({
    where: and(
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, position.vaultPubkey),
      eq(managedVaults.active, true)
    ),
  });
  if (!vault) {
    return position;
  }

  const latestEvent = await findLatestHoldingEventForPosition(
    position.id,
    dependencies
  );
  const positionForRead = await projectPositionForUserFacingRead(
    position,
    latestEvent,
    dependencies
  );
  const currentRows = await dependencies.client.db
    .select()
    .from(vaultReservePositionsCurrent)
    .where(
      and(
        eq(vaultReservePositionsCurrent.vaultId, vault.id),
        sql`${vaultReservePositionsCurrent.amountRaw} > 0`
      )
    )
    .orderBy(
      desc(vaultReservePositionsCurrent.observedSlot),
      desc(vaultReservePositionsCurrent.amountRaw),
      desc(vaultReservePositionsCurrent.snapshotId)
    );
  const [current] = filterUserFacingYieldVaultReservePositions(
    currentRows as CurrentYieldVaultReservePositionRecord[]
  );

  if (!current) {
    return positionForRead;
  }
  if (
    input.skipCurrentRowsObservedAtOrAfterSlot !== undefined &&
    current.observedSlot >= input.skipCurrentRowsObservedAtOrAfterSlot
  ) {
    return positionForRead;
  }
  if (current.observedSlot <= position.currentObservedSlot) {
    return positionForRead;
  }

  if (latestEvent && currentVaultPositionMatchesEvent(current, latestEvent)) {
    if (currentPositionMatchesHoldingEvent(position, latestEvent)) {
      return position;
    }

    return applyHoldingEventToPosition({
      client: dependencies.client,
      event: latestEvent,
      now: dependencies.now(),
    });
  }

  const decision =
    await dependencies.client.db.query.rebalanceDecisions.findFirst({
      orderBy: [
        desc(rebalanceDecisions.confirmedSlot),
        desc(rebalanceDecisions.id),
      ],
      where: and(
        eq(rebalanceDecisions.vaultId, vault.id),
        eq(rebalanceDecisions.status, "confirmed"),
        eq(rebalanceDecisions.targetReserve, current.reserve),
        eq(rebalanceDecisions.postSnapshotId, current.snapshotId)
      ),
    });

  if (decision?.signature && decision.confirmedSlot !== null) {
    return recordConfirmedYieldRebalance(
      {
        amountRaw: current.amountRaw,
        cluster: input.cluster,
        liquidityMint: current.liquidityMint,
        market: current.market,
        observedAt: current.observedAt,
        observedSlot: current.observedSlot,
        positionId: position.id,
        reserve: current.reserve,
        sourceRebalanceDecisionId: decision.id,
        sourceSignature: decision.signature,
        sourceSnapshotId: current.snapshotId,
      },
      dependencies
    );
  }

  return recordSnapshotReconciledYieldHolding(
    {
      amountRaw: current.amountRaw,
      cluster: input.cluster,
      liquidityMint: current.liquidityMint,
      market: current.market,
      observedAt: current.observedAt,
      observedSlot: current.observedSlot,
      positionId: position.id,
      reserve: current.reserve,
      sourceSnapshotId: current.snapshotId,
    },
    dependencies
  );
}

export async function findCurrentNonzeroYieldVaultReservePositions(
  input: ActiveYieldPositionForVaultLookupInput & { vaultPubkey?: string },
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<CurrentYieldVaultReservePositionRecord[]> {
  const position = await findActiveYieldPositionForVault(input, dependencies);
  if (!position) {
    return [];
  }

  const vault = await dependencies.client.db.query.managedVaults.findFirst({
    where: and(
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, input.vaultPubkey ?? position.vaultPubkey),
      eq(managedVaults.active, true)
    ),
  });
  if (!vault) {
    return [];
  }

  const rows = await dependencies.client.db
    .select()
    .from(vaultReservePositionsCurrent)
    .where(
      and(
        eq(vaultReservePositionsCurrent.vaultId, vault.id),
        sql`${vaultReservePositionsCurrent.amountRaw} > 0`
      )
    )
    .orderBy(
      desc(vaultReservePositionsCurrent.observedSlot),
      desc(vaultReservePositionsCurrent.amountRaw),
      desc(vaultReservePositionsCurrent.snapshotId)
    );

  return filterUserFacingYieldVaultReservePositions(
    rows as CurrentYieldVaultReservePositionRecord[]
  );
}

export async function findCurrentYieldVaultIdleTokenBalances(
  input: ActiveYieldPositionForVaultLookupInput & { vaultPubkey?: string },
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<CurrentYieldVaultIdleTokenBalanceRecord[]> {
  const position = await findActiveYieldPositionForVault(input, dependencies);
  if (!position) {
    return [];
  }

  const vault = await dependencies.client.db.query.managedVaults.findFirst({
    where: and(
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, input.vaultPubkey ?? position.vaultPubkey),
      eq(managedVaults.active, true)
    ),
  });
  if (!vault) {
    return [];
  }

  return dependencies.client.db
    .select()
    .from(vaultIdleTokenBalancesCurrent)
    .where(
      and(
        eq(vaultIdleTokenBalancesCurrent.vaultId, vault.id),
        sql`${vaultIdleTokenBalancesCurrent.amountRaw} > 0`
      )
    )
    .orderBy(
      desc(vaultIdleTokenBalancesCurrent.observedSlot),
      desc(vaultIdleTokenBalancesCurrent.updatedAt)
    );
}

export async function findActiveYieldRoutePolicyPair(
  input: {
    authority: string;
    cluster: string;
    settings: string;
    vaultIndex: number;
    vaultPubkey?: string;
  },
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<ActiveYieldRoutePolicyPair | null> {
  const client = dependencies.client;
  const vaultFilters = [
    eq(managedVaults.active, true),
    eq(managedVaults.settings, input.settings),
    eq(managedVaults.vaultIndex, input.vaultIndex),
  ];
  if (input.vaultPubkey) {
    vaultFilters.push(eq(managedVaults.vaultPubkey, input.vaultPubkey));
  }

  const vault = await client.db.query.managedVaults.findFirst({
    where: and(...vaultFilters),
    orderBy: [desc(managedVaults.lastSeenAt), desc(managedVaults.id)],
  });
  if (!vault) {
    return null;
  }

  const routePolicy = await client.db.query.routePolicies.findFirst({
    where: and(
      eq(routePolicies.active, true),
      eq(routePolicies.authority, input.authority),
      eq(routePolicies.id, vault.activePolicyId),
      eq(routePolicies.settings, input.settings),
      eq(routePolicies.vaultIndex, input.vaultIndex),
      eq(routePolicies.vaultPubkey, vault.vaultPubkey)
    ),
  });

  if (!routePolicy) {
    return null;
  }

  const setupPolicy =
    typeof vault.setupPolicyId !== "bigint"
      ? null
      : await client.db.query.routePolicies.findFirst({
          where: and(
            eq(routePolicies.active, true),
            eq(routePolicies.authority, input.authority),
            eq(routePolicies.id, vault.setupPolicyId),
            eq(routePolicies.settings, input.settings),
            eq(routePolicies.vaultIndex, input.vaultIndex),
            eq(routePolicies.vaultPubkey, vault.vaultPubkey)
          ),
        });

  return {
    routePolicy,
    setupPolicy: setupPolicy ?? null,
  };
}

export async function findEarnCleanupVaultState(
  input: {
    authority: string;
    includeInactive?: boolean;
    settings: string;
    vaultIndex: number;
    vaultPubkey: string;
  },
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<EarnCleanupVaultState | null> {
  const client = dependencies.client;
  const vault = await client.db.query.managedVaults.findFirst({
    where: and(
      ...(input.includeInactive ? [] : [eq(managedVaults.active, true)]),
      eq(managedVaults.settings, input.settings),
      eq(managedVaults.vaultIndex, input.vaultIndex),
      eq(managedVaults.vaultPubkey, input.vaultPubkey)
    ),
    orderBy: [desc(managedVaults.lastSeenAt), desc(managedVaults.id)],
  });
  if (!vault) {
    return null;
  }

  const routePolicy = await client.db.query.routePolicies.findFirst({
    where: and(
      ...(input.includeInactive ? [] : [eq(routePolicies.active, true)]),
      eq(routePolicies.authority, input.authority),
      eq(routePolicies.id, vault.activePolicyId),
      eq(routePolicies.settings, input.settings),
      eq(routePolicies.vaultIndex, input.vaultIndex),
      eq(routePolicies.vaultPubkey, vault.vaultPubkey)
    ),
  });
  if (!routePolicy) {
    return null;
  }

  const [setupPolicy, reserveRows, idleRows] = await Promise.all([
    typeof vault.setupPolicyId !== "bigint"
      ? Promise.resolve(null)
      : client.db.query.routePolicies.findFirst({
          where: and(
            ...(input.includeInactive ? [] : [eq(routePolicies.active, true)]),
            eq(routePolicies.authority, input.authority),
            eq(routePolicies.id, vault.setupPolicyId),
            eq(routePolicies.settings, input.settings),
            eq(routePolicies.vaultIndex, input.vaultIndex),
            eq(routePolicies.vaultPubkey, vault.vaultPubkey)
          ),
        }),
    client.db
      .select()
      .from(vaultReservePositionsCurrent)
      .where(eq(vaultReservePositionsCurrent.vaultId, vault.id))
      .orderBy(
        desc(vaultReservePositionsCurrent.observedSlot),
        desc(vaultReservePositionsCurrent.amountRaw),
        desc(vaultReservePositionsCurrent.snapshotId)
      ),
    client.db
      .select()
      .from(vaultIdleTokenBalancesCurrent)
      .where(
        and(
          eq(vaultIdleTokenBalancesCurrent.vaultId, vault.id),
          sql`${vaultIdleTokenBalancesCurrent.amountRaw} > 0`
        )
      )
      .orderBy(
        desc(vaultIdleTokenBalancesCurrent.observedSlot),
        desc(vaultIdleTokenBalancesCurrent.updatedAt)
      ),
  ]);

  return {
    idleRows,
    reserveRows: filterUserFacingYieldVaultReservePositions(
      reserveRows as CurrentYieldVaultReservePositionRecord[]
    ),
    routePolicy,
    setupPolicy: setupPolicy ?? null,
    vault,
  };
}

export async function findActiveManagedYieldVaultWithPolicy(
  input: {
    authority: string;
    cluster: string;
    settings: string;
    vaultIndex: number;
    vaultPubkey?: string;
  },
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<ActiveManagedYieldVaultWithPolicy | null> {
  const client = dependencies.client;
  const vaultFilters = [
    eq(managedVaults.active, true),
    eq(managedVaults.settings, input.settings),
    eq(managedVaults.vaultIndex, input.vaultIndex),
  ];
  if (input.vaultPubkey) {
    vaultFilters.push(eq(managedVaults.vaultPubkey, input.vaultPubkey));
  }

  const vault = await client.db.query.managedVaults.findFirst({
    where: and(...vaultFilters),
    orderBy: [desc(managedVaults.lastSeenAt), desc(managedVaults.id)],
  });
  if (!vault) {
    return null;
  }

  const routePolicy = await client.db.query.routePolicies.findFirst({
    where: and(
      eq(routePolicies.active, true),
      eq(routePolicies.authority, input.authority),
      eq(routePolicies.id, vault.activePolicyId),
      eq(routePolicies.settings, input.settings),
      eq(routePolicies.vaultIndex, input.vaultIndex),
      eq(routePolicies.vaultPubkey, vault.vaultPubkey)
    ),
  });
  if (!routePolicy) {
    return null;
  }

  const setupPolicy =
    typeof vault.setupPolicyId !== "bigint"
      ? null
      : await client.db.query.routePolicies.findFirst({
          where: and(
            eq(routePolicies.active, true),
            eq(routePolicies.authority, input.authority),
            eq(routePolicies.id, vault.setupPolicyId),
            eq(routePolicies.settings, input.settings),
            eq(routePolicies.vaultIndex, input.vaultIndex),
            eq(routePolicies.vaultPubkey, vault.vaultPubkey)
          ),
        });

  return {
    routePolicy,
    setupPolicy: setupPolicy ?? null,
    vault,
  };
}

export async function findActiveYieldRoutePolicy(input: {
  authority: string;
  cluster: string;
  settings: string;
  vaultIndex: number;
  vaultPubkey?: string;
}): Promise<RoutePolicyRecord | null> {
  const pair = await findActiveYieldRoutePolicyPair(input);
  return pair?.routePolicy ?? null;
}

export function deriveEarnDepositOnboardingNextStep(args: {
  attempt: EarnDepositOnboardingAttemptRecord | null;
  hasActivePosition: boolean;
  policyPair: ActiveYieldRoutePolicyPair | null;
}): EarnDepositOnboardingNextStep {
  if (args.hasActivePosition) {
    return "complete";
  }

  if (
    args.attempt?.status === "accounting_failed" ||
    (args.attempt?.status === "deposit_confirmed" &&
      args.attempt.depositSignature)
  ) {
    return "deposit_accounting_retry";
  }

  if (args.policyPair?.routePolicy && args.policyPair.setupPolicy) {
    return "deposit";
  }

  if (args.attempt?.setupPolicySignature) {
    return "deposit";
  }

  if (args.policyPair?.routePolicy || args.attempt?.routePolicySignature) {
    return "setup_policy";
  }

  return "route_policy";
}

export async function findCurrentEarnDepositOnboardingAttempt(
  input: {
    settings: string;
    vaultIndex: number;
    vaultPubkey?: string;
    walletAddress: string;
  },
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<EarnDepositOnboardingAttemptRecord | null> {
  const filters = [
    eq(earnDepositOnboardingAttempts.settings, input.settings),
    eq(earnDepositOnboardingAttempts.vaultIndex, input.vaultIndex),
    eq(earnDepositOnboardingAttempts.walletAddress, input.walletAddress),
    sql`${earnDepositOnboardingAttempts.status} <> 'complete'`,
  ];
  if (input.vaultPubkey) {
    filters.push(
      eq(earnDepositOnboardingAttempts.vaultPubkey, input.vaultPubkey)
    );
  }

  const attempt =
    await dependencies.client.db.query.earnDepositOnboardingAttempts.findFirst({
      where: and(...filters),
      orderBy: [
        desc(earnDepositOnboardingAttempts.updatedAt),
        desc(earnDepositOnboardingAttempts.id),
      ],
    });

  return (attempt as EarnDepositOnboardingAttemptRecord | undefined) ?? null;
}

export async function recordReconciledYieldVaultSnapshot(
  input: ReconciledYieldVaultSnapshotInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<{ snapshotId: bigint }> {
  const now = dependencies.now();
  const observedAt = input.observedAt ?? now;

  const [snapshot] = await dependencies.client.db
    .insert(vaultPositionSnapshots)
    .values({
      chainSlot: input.chainSlot ?? null,
      context: input.context,
      isCurrent: false,
      observedAt,
      observedSlot: input.observedSlot,
      policyId: input.policyId,
      vaultId: input.vaultId,
    })
    .returning({ id: vaultPositionSnapshots.id });

  if (!snapshot) {
    throw new Error("Failed to record reconciled yield vault snapshot.");
  }

  const snapshotPositionValues = input.positions.map((position) => ({
    amountRaw: position.amountRaw,
    borrowApyBps: position.borrowApyBps ?? null,
    hasValue: position.hasValue,
    liquidityMint: position.liquidityMint,
    market: position.market,
    planningMetadata: {
      source: "frontend_position_reconcile",
      ...(position.planningMetadata ?? {}),
    },
    reserve: position.reserve,
    snapshotId: snapshot.id,
    supplyApyBps: position.supplyApyBps ?? null,
  }));
  const currentPositionValues = snapshotPositionValues.map((position) => ({
    amountRaw: position.amountRaw,
    borrowApyBps: position.borrowApyBps,
    hasValue: position.hasValue,
    liquidityMint: position.liquidityMint,
    market: position.market,
    observedAt,
    observedSlot: input.observedSlot,
    planningMetadata: position.planningMetadata,
    reserve: position.reserve,
    snapshotId: snapshot.id,
    supplyApyBps: position.supplyApyBps,
    vaultId: input.vaultId,
  }));

  const statements: never[] = [
    dependencies.client.db
      .update(vaultPositionSnapshots)
      .set({ isCurrent: false })
      .where(eq(vaultPositionSnapshots.vaultId, input.vaultId)) as never,
    dependencies.client.db
      .delete(vaultReservePositionsCurrent)
      .where(eq(vaultReservePositionsCurrent.vaultId, input.vaultId)) as never,
  ];

  if (snapshotPositionValues.length > 0) {
    statements.push(
      dependencies.client.db
        .insert(vaultPositionSnapshotPositions)
        .values(snapshotPositionValues) as never
    );
    statements.push(
      dependencies.client.db
        .insert(vaultReservePositionsCurrent)
        .values(currentPositionValues) as never
    );
  }

  statements.push(
    dependencies.client.db
      .insert(vaultIdleTokenBalancesCurrent)
      .values({
        amountRaw: input.idleTokenBalance.amountRaw,
        mint: input.idleTokenBalance.mint,
        observedAt,
        observedSlot: input.observedSlot,
        owner: input.idleTokenBalance.owner,
        sourceCommitment: input.sourceCommitment,
        tokenAccount: input.idleTokenBalance.tokenAccount,
        updatedAt: now,
        vaultId: input.vaultId,
      })
      .onConflictDoUpdate({
        target: [
          vaultIdleTokenBalancesCurrent.vaultId,
          vaultIdleTokenBalancesCurrent.mint,
        ],
        set: {
          amountRaw: input.idleTokenBalance.amountRaw,
          observedAt,
          observedSlot: input.observedSlot,
          owner: input.idleTokenBalance.owner,
          sourceCommitment: input.sourceCommitment,
          tokenAccount: input.idleTokenBalance.tokenAccount,
          updatedAt: now,
        },
      }) as never
  );
  statements.push(
    dependencies.client.db
      .update(vaultPositionSnapshots)
      .set({ isCurrent: true })
      .where(eq(vaultPositionSnapshots.id, snapshot.id)) as never
  );
  statements.push(
    dependencies.client.db
      .update(managedVaults)
      .set({
        lastReconciledAt: observedAt,
        lastReconciledSlot: input.observedSlot,
        lastSeenAt: now,
      })
      .where(eq(managedVaults.id, input.vaultId)) as never
  );

  await dependencies.client.db.batch(statements as [never, ...never[]]);

  return { snapshotId: snapshot.id };
}

export async function findYieldPositionEvents(
  input: YieldPositionEventsLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionEventRecord[]> {
  const depositFilters = [
    eq(userYieldPositionDeposits.settings, input.settings),
    eq(userYieldPositionDeposits.vaultIndex, input.vaultIndex),
    eq(userYieldPositionDeposits.walletAddress, input.walletAddress),
  ];
  const withdrawalFilters = [
    eq(userYieldPositionWithdrawals.settings, input.settings),
    eq(userYieldPositionWithdrawals.vaultIndex, input.vaultIndex),
    eq(userYieldPositionWithdrawals.walletAddress, input.walletAddress),
  ];

  if (input.vaultPubkey) {
    depositFilters.push(
      eq(userYieldPositionDeposits.vaultPubkey, input.vaultPubkey)
    );
    withdrawalFilters.push(
      eq(userYieldPositionWithdrawals.vaultPubkey, input.vaultPubkey)
    );
  }

  const [deposits, withdrawals] = await dependencies.client.db.batch([
    dependencies.client.db
      .select({
        amountRaw: userYieldPositionDeposits.principalAmountRaw,
        confirmedAt: userYieldPositionDeposits.confirmedAt,
      })
      .from(userYieldPositionDeposits)
      .where(and(...depositFilters))
      .orderBy(asc(userYieldPositionDeposits.confirmedAt)),
    dependencies.client.db
      .select({
        amountRaw: userYieldPositionWithdrawals.withdrawnAmountRaw,
        confirmedAt: userYieldPositionWithdrawals.confirmedAt,
      })
      .from(userYieldPositionWithdrawals)
      .where(and(...withdrawalFilters))
      .orderBy(asc(userYieldPositionWithdrawals.confirmedAt)),
  ]);

  return [
    ...deposits.map((deposit) => ({
      amountRaw: deposit.amountRaw,
      confirmedAt: deposit.confirmedAt,
      type: "deposit" as const,
    })),
    ...withdrawals.map((withdrawal) => ({
      amountRaw: withdrawal.amountRaw,
      confirmedAt: withdrawal.confirmedAt,
      type: "withdrawal" as const,
    })),
  ].sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime());
}

export async function findYieldPositionHistoryEvents(
  input: ActiveYieldPositionLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionHistoryEventRecord[]> {
  // Closed positions (full withdrawals) must keep their history visible.
  const position = await findYieldPosition(input, dependencies);
  if (!position) {
    return [];
  }

  return findYieldPositionHistoryEventsForPosition(position, dependencies);
}

export async function findYieldPositionHistoryEventsForVault(
  input: ActiveYieldPositionForVaultLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionHistoryEventRecord[]> {
  const positions =
    await dependencies.client.db.query.userYieldPositions.findMany({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress)
      ),
      orderBy: [
        desc(userYieldPositions.updatedAt),
        desc(userYieldPositions.id),
      ],
    });

  const eventGroups = await Promise.all(
    positions.map((position) =>
      findYieldPositionHistoryEventsForPosition(position, dependencies)
    )
  );

  return sortYieldPositionHistoryEventsDescending(eventGroups.flat());
}

async function findYieldPositionHistoryEventsForPosition(
  position: UserYieldPositionRecord,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">
): Promise<UserYieldPositionHistoryEventRecord[]> {
  const events = await dependencies.client.db
    .select({
      amountRaw: userYieldPositionHoldingEvents.amountRaw,
      confirmedAt: userYieldPositionHoldingEvents.observedAt,
      confirmedSlot: userYieldPositionHoldingEvents.observedSlot,
      eventType: userYieldPositionHoldingEvents.eventType,
      id: userYieldPositionHoldingEvents.id,
      liquidityMint: userYieldPositionHoldingEvents.liquidityMint,
      market: userYieldPositionHoldingEvents.market,
      principalDeltaRaw: userYieldPositionHoldingEvents.principalDeltaRaw,
      reserve: userYieldPositionHoldingEvents.reserve,
      signature: userYieldPositionHoldingEvents.sourceSignature,
      sourceDepositId: userYieldPositionHoldingEvents.sourceDepositId,
      sourceRebalanceDecisionId:
        userYieldPositionHoldingEvents.sourceRebalanceDecisionId,
      sourceSnapshotId: userYieldPositionHoldingEvents.sourceSnapshotId,
      sourceWithdrawalId: userYieldPositionHoldingEvents.sourceWithdrawalId,
    })
    .from(userYieldPositionHoldingEvents)
    .where(and(eq(userYieldPositionHoldingEvents.positionId, position.id)));

  let previousReserve: string | null = position.initialReserve;
  let previousMarket: string | null = position.initialMarket;
  let previousLiquidityMint: string | null = position.initialLiquidityMint;
  let principalAmountRaw = BigInt(0);
  const chronologicalEvents = [...events].sort((a, b) => {
    if (a.confirmedSlot !== b.confirmedSlot) {
      return a.confirmedSlot < b.confirmedSlot ? -1 : 1;
    }
    const confirmedAtDelta = a.confirmedAt.getTime() - b.confirmedAt.getTime();
    if (confirmedAtDelta !== 0) {
      return confirmedAtDelta;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const withdrawalIds = chronologicalEvents
    .map((event) => event.sourceWithdrawalId)
    .filter((id): id is bigint => id !== null);
  const depositIds = chronologicalEvents
    .map((event) => event.sourceDepositId)
    .filter((id): id is bigint => id !== null);
  const depositAmounts =
    depositIds.length > 0
      ? await dependencies.client.db
          .select({
            id: userYieldPositionDeposits.id,
            principalAmountRaw: userYieldPositionDeposits.principalAmountRaw,
          })
          .from(userYieldPositionDeposits)
          .where(inArray(userYieldPositionDeposits.id, depositIds))
      : [];
  const withdrawals =
    withdrawalIds.length > 0
      ? await dependencies.client.db
          .select({
            id: userYieldPositionWithdrawals.id,
            mode: userYieldPositionWithdrawals.mode,
            sourceType: userYieldPositionWithdrawals.sourceType,
            withdrawnAmountRaw: userYieldPositionWithdrawals.withdrawnAmountRaw,
          })
          .from(userYieldPositionWithdrawals)
          .where(inArray(userYieldPositionWithdrawals.id, withdrawalIds))
      : [];
  const depositAmountById = new Map(
    depositAmounts.map((deposit) => [deposit.id, deposit.principalAmountRaw])
  );
  const withdrawalById = new Map(
    withdrawals.map((withdrawal) => [withdrawal.id, withdrawal])
  );

  const history = chronologicalEvents.map((event) => {
    const type: UserYieldPositionHistoryEventRecord["type"] =
      event.eventType === "rebalance_confirmed"
        ? "rebalance"
        : event.eventType === "snapshot_reconciled"
        ? "reconciliation"
        : event.eventType === "withdrawal_partial" ||
          event.eventType === "withdrawal_full"
        ? "withdrawal"
        : "deposit";

    const sourceReserve =
      type === "rebalance" || type === "reconciliation"
        ? previousReserve
        : null;
    const sourceMarket =
      type === "rebalance" || type === "reconciliation" ? previousMarket : null;
    const sourceLiquidityMint =
      type === "rebalance" || type === "reconciliation"
        ? previousLiquidityMint
        : null;
    if (type === "deposit") {
      const principalDeltaRaw =
        event.sourceDepositId === null
          ? event.principalDeltaRaw
          : depositAmountById.get(event.sourceDepositId) ??
            event.principalDeltaRaw;
      if (principalDeltaRaw && principalDeltaRaw > BigInt(0)) {
        principalAmountRaw += principalDeltaRaw;
      }
    } else if (type === "withdrawal") {
      const withdrawal =
        event.sourceWithdrawalId === null
          ? null
          : withdrawalById.get(event.sourceWithdrawalId) ?? null;
      if (withdrawal?.sourceType === "idle") {
        // Closing leftover idle dust does not reduce invested principal.
      } else if (
        withdrawal?.mode === "full" ||
        event.eventType === "withdrawal_full"
      ) {
        principalAmountRaw = BigInt(0);
      } else {
        const principalDeltaRaw = event.principalDeltaRaw ?? BigInt(0);
        const withdrawnPrincipalRaw =
          withdrawal?.withdrawnAmountRaw ??
          (principalDeltaRaw < BigInt(0) ? -principalDeltaRaw : BigInt(0));
        principalAmountRaw =
          principalAmountRaw > withdrawnPrincipalRaw
            ? principalAmountRaw - withdrawnPrincipalRaw
            : BigInt(0);
      }
    }
    previousReserve = event.reserve;
    previousMarket = event.market;
    previousLiquidityMint = event.liquidityMint;

    return {
      amountRaw: event.amountRaw,
      confirmedAt: event.confirmedAt,
      confirmedSlot: event.confirmedSlot,
      destinationReserve:
        type === "rebalance" || type === "reconciliation"
          ? event.reserve
          : null,
      destinationMarket:
        type === "rebalance" || type === "reconciliation" ? event.market : null,
      destinationLiquidityMint:
        type === "rebalance" || type === "reconciliation"
          ? event.liquidityMint
          : null,
      eventType: event.eventType,
      id: event.id,
      liquidityMint: event.liquidityMint,
      market: event.market,
      principalDeltaRaw: event.principalDeltaRaw,
      principalAmountRaw,
      reserve: event.reserve,
      signature:
        event.signature ??
        [
          type,
          event.sourceDepositId?.toString(),
          event.sourceWithdrawalId?.toString(),
          event.sourceRebalanceDecisionId?.toString(),
          event.sourceSnapshotId?.toString(),
        ]
          .filter(Boolean)
          .join(":"),
      sourceLiquidityMint,
      sourceMarket,
      sourceReserve,
      type,
      withdrawnAmountRaw:
        event.sourceWithdrawalId === null
          ? null
          : withdrawalById.get(event.sourceWithdrawalId)?.withdrawnAmountRaw ??
            null,
    };
  });

  return sortYieldPositionHistoryEventsDescending(history);
}

export async function recordConfirmedYieldWithdrawal(
  input: ConfirmedYieldWithdrawalInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<UserYieldPositionRecord> {
  if (input.withdrawnAmountRaw <= BigInt(0)) {
    throw new Error("Withdrawn amount must be greater than 0.");
  }
  if (input.mode !== "partial" && input.mode !== "full") {
    throw new Error("Withdrawal mode must be partial or full.");
  }

  const { client } = dependencies;
  const now = dependencies.now();
  const idempotentWithdrawal = await findIdempotentWithdrawalPosition(
    input,
    dependencies
  );
  if (idempotentWithdrawal) {
    await repairCurrentVaultSourceWithdrawalForIdempotentRecord({
      dependencies,
      input,
      withdrawal: idempotentWithdrawal.withdrawal,
    });
    if (idempotentWithdrawal.position.status === "closed") {
      await recordZeroCurrentVaultPositionsAfterFullWithdrawal(
        input,
        dependencies
      );
      await deactivateVaultAfterFullWithdrawal(input, dependencies, now);
    }
    return idempotentWithdrawal.position;
  }

  const existingPosition = await findReconciledActiveYieldPositionForVault(
    {
      cluster: input.cluster,
      settings: input.settings,
      vaultIndex: input.vaultIndex,
      walletAddress: input.walletAddress,
    },
    dependencies
  );

  if (!existingPosition) {
    throw new Error("No active yield position exists for this withdrawal.");
  }
  if (existingPosition.status !== "active") {
    throw new Error("Yield position is not active.");
  }
  const withdrawalSource = await resolveWithdrawalSource(input, dependencies);
  if (
    withdrawalSource.sourceType === "reserve" &&
    input.reserveWithdrawals &&
    input.reserveWithdrawals.length > 0
  ) {
    const allPreparedRowsMatch = input.reserveWithdrawals.every((withdrawal) =>
      withdrawalSource.reserveRows.some(
        (row) =>
          row.reserve === withdrawal.accountingReserve &&
          row.liquidityMint === withdrawal.liquidityMint &&
          row.market === withdrawal.market &&
          row.amountRaw > BigInt(0)
      )
    );
    if (!allPreparedRowsMatch) {
      throw new Error(
        "Withdrawal target does not match a reconciled Earn holding."
      );
    }
  }
  if (
    withdrawalSource.sourceType === "reserve" &&
    withdrawalSource.selectedReserveRow &&
    (withdrawalSource.selectedReserveRow.reserve !== input.targetReserve ||
      withdrawalSource.selectedReserveRow.liquidityMint !==
        input.liquidityMint ||
      withdrawalSource.selectedReserveRow.market !== input.market)
  ) {
    throw new Error(
      "Withdrawal target does not match the selected Earn reserve."
    );
  }

  const smartAccountAddress = canonicalYieldSmartAccountAddress(input);
  const withdrawalValues = {
    confirmedAt: now,
    confirmedSlot: input.confirmedSlot,
    createdAt: now,
    liquidityMint: input.liquidityMint,
    market: input.market,
    mode: input.mode,
    policyAccount: input.policyAccount,
    policyId: input.policyId,
    policySeed: input.policySeed,
    reserveWithdrawals: input.reserveWithdrawals ?? [],
    sourceId: withdrawalSource.sourceId,
    sourceMetadata: buildStoredWithdrawalSourceMetadata({
      sourceAmountRaw: withdrawalSource.sourceAmountRaw,
      sourceMetadata: withdrawalSource.sourceMetadata,
      sourceMint: withdrawalSource.sourceMint,
      sourceTokenAccount: withdrawalSource.sourceTokenAccount,
    }),
    sourceType: withdrawalSource.sourceType,
    settings: input.settings,
    smartAccountAddress,
    targetReserve: input.targetReserve,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
    withdrawalSignature: input.withdrawalSignature,
    withdrawnAmountRaw: input.withdrawnAmountRaw,
  };
  const nextPrincipal = withdrawalSource.isFinalExit
    ? BigInt(0)
    : withdrawalSource.sourceType === "idle"
    ? existingPosition.principalAmountRaw
    : existingPosition.principalAmountRaw > input.withdrawnAmountRaw
    ? existingPosition.principalAmountRaw - input.withdrawnAmountRaw
    : BigInt(0);
  const insertedWithdrawals = await client.db
    .insert(userYieldPositionWithdrawals)
    .values(withdrawalValues)
    .onConflictDoNothing({
      target: [userYieldPositionWithdrawals.withdrawalSignature],
    })
    .returning({ id: userYieldPositionWithdrawals.id });

  if (insertedWithdrawals.length === 0) {
    const duplicateWithdrawal = await findIdempotentWithdrawalPosition(
      input,
      dependencies
    );
    if (duplicateWithdrawal) {
      await repairCurrentVaultSourceWithdrawalForIdempotentRecord({
        dependencies,
        input,
        withdrawal: duplicateWithdrawal.withdrawal,
      });
      return duplicateWithdrawal.position;
    }
    return existingPosition;
  }

  const [insertedWithdrawal] = insertedWithdrawals;
  const nextHoldingAmountRaw = withdrawalSource.isFinalExit
    ? BigInt(0)
    : withdrawalSource.remainingReserveAmountRaw +
      withdrawalSource.remainingIdleAmountRaw;
  const principalDeltaRaw = withdrawalSource.isFinalExit
    ? -existingPosition.principalAmountRaw
    : withdrawalSource.sourceType === "idle"
    ? BigInt(0)
    : -(existingPosition.principalAmountRaw > input.withdrawnAmountRaw
        ? input.withdrawnAmountRaw
        : existingPosition.principalAmountRaw);
  const event = await insertHoldingEvent({
    amountRaw: nextHoldingAmountRaw,
    client,
    createdAt: now,
    eventType: withdrawalSource.isFinalExit
      ? "withdrawal_full"
      : "withdrawal_partial",
    holdingDeltaRaw: nextHoldingAmountRaw - existingPosition.currentAmountRaw,
    liquidityMint:
      withdrawalSource.selectedReserveRow?.liquidityMint ??
      existingPosition.currentLiquidityMint,
    market:
      withdrawalSource.selectedReserveRow?.market ??
      existingPosition.currentMarket,
    observedAt: now,
    observedSlot: input.confirmedSlot,
    positionId: existingPosition.id,
    principalDeltaRaw,
    reserve:
      withdrawalSource.selectedReserveRow?.reserve ??
      existingPosition.currentReserve,
    sourceSignature: input.withdrawalSignature,
    sourceWithdrawalId: insertedWithdrawal.id,
  });

  const position = await applyHoldingEventToPosition({
    client,
    event,
    lastConfirmedSlot: input.confirmedSlot,
    now,
    principalAmountRaw: withdrawalSource.isFinalExit
      ? BigInt(0)
      : withdrawalSource.sourceType === "idle"
      ? existingPosition.principalAmountRaw
      : nextPrincipal,
    status: withdrawalSource.isFinalExit ? "closed" : "active",
  });

  await recordCurrentVaultSourceWithdrawal({
    dependencies,
    input,
    resolution: withdrawalSource,
  });

  if (withdrawalSource.isFinalExit) {
    await deactivateVaultAfterFullWithdrawal(input, dependencies, now);
  }

  if (position.principalAmountRaw !== nextPrincipal) {
    return position;
  }

  return position;
}

export async function recordConfirmedYieldRebalance(
  input: ConfirmedYieldRebalanceInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<UserYieldPositionRecord> {
  const now = dependencies.now();
  const observedAt = input.observedAt ?? now;
  const event = await insertIdempotentRebalanceHoldingEvent({
    amountRaw: input.amountRaw,
    client: dependencies.client,
    createdAt: now,
    liquidityMint: input.liquidityMint,
    market: input.market,
    observedAt,
    observedSlot: input.observedSlot,
    positionId: input.positionId,
    reserve: input.reserve,
    sourceRebalanceDecisionId: input.sourceRebalanceDecisionId,
    sourceSignature: input.sourceSignature,
    sourceSnapshotId: input.sourceSnapshotId,
  });

  return applyRebalanceHoldingEventToPosition({
    client: dependencies.client,
    event,
    lastRebalanceDecisionId: input.sourceRebalanceDecisionId,
    now,
  });
}

export async function syncConfirmedRebalanceHoldingEventsForVault(
  input: ActiveYieldPositionForVaultLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> &
    Partial<Pick<YieldDepositRepositoryDependencies, "now">> = {
    client: getYieldOptimizationClient(),
  }
): Promise<SyncConfirmedRebalanceHoldingEventsResult> {
  const now = dependencies.now?.() ?? new Date();
  const queryResult = await dependencies.client.db.execute(sql`
    WITH candidate_events AS (
      SELECT DISTINCT ON (decision.id)
        position.id AS position_id,
        decision.id AS decision_id,
        decision.signature AS source_signature,
        decision.post_snapshot_id AS source_snapshot_id,
        snapshot.observed_slot,
        snapshot.observed_at,
        snapshot_position.reserve,
        snapshot_position.market,
        snapshot_position.liquidity_mint,
        snapshot_position.amount_raw
      FROM loyal_yield.rebalance_decisions decision
      INNER JOIN loyal_yield.managed_vaults vault
        ON vault.id = decision.vault_id
       AND vault.active = TRUE
      INNER JOIN loyal_yield.route_policies policy
        ON policy.id = vault.active_policy_id
       AND policy.active = TRUE
       AND policy.settings = vault.settings
       AND policy.vault_index = vault.vault_index
       AND policy.vault_pubkey = vault.vault_pubkey
      INNER JOIN loyal_yield.user_yield_positions position
        ON position.settings = policy.settings
       AND position.wallet_address = policy.authority
       AND position.vault_index = policy.vault_index
       AND position.vault_pubkey = policy.vault_pubkey
       AND position.status = 'active'::loyal_yield.yield_position_status
      INNER JOIN loyal_yield.vault_position_snapshots snapshot
        ON snapshot.id = decision.post_snapshot_id
       AND snapshot.vault_id = decision.vault_id
      INNER JOIN loyal_yield.vault_position_snapshot_positions snapshot_position
        ON snapshot_position.snapshot_id = snapshot.id
       AND snapshot_position.reserve = decision.target_reserve
       AND snapshot_position.amount_raw > 0
      WHERE decision.status = 'confirmed'::loyal_yield.decision_status
        AND decision.signature IS NOT NULL
        AND decision.post_snapshot_id IS NOT NULL
        AND vault.settings = ${input.settings}
        AND vault.vault_index = ${input.vaultIndex}
        AND policy.authority = ${input.walletAddress}
      ORDER BY
        decision.id,
        position.updated_at DESC,
        position.id DESC,
        snapshot_position.amount_raw DESC,
        snapshot_position.id DESC
    ),
    inserted_events AS (
      INSERT INTO loyal_yield.user_yield_position_holding_events (
        position_id,
        event_type,
        reserve,
        market,
        liquidity_mint,
        amount_raw,
        principal_delta_raw,
        holding_delta_raw,
        observed_slot,
        observed_at,
        source_signature,
        source_deposit_id,
        source_withdrawal_id,
        source_rebalance_decision_id,
        source_snapshot_id,
        created_at
      )
      SELECT
        candidate.position_id,
        'rebalance_confirmed'::loyal_yield.user_yield_holding_event_type,
        candidate.reserve,
        candidate.market,
        candidate.liquidity_mint,
        candidate.amount_raw,
        NULL,
        NULL,
        candidate.observed_slot,
        candidate.observed_at,
        candidate.source_signature,
        NULL,
        NULL,
        candidate.decision_id,
        candidate.source_snapshot_id,
        ${now}
      FROM candidate_events candidate
      ON CONFLICT (source_rebalance_decision_id)
        WHERE source_rebalance_decision_id IS NOT NULL
      DO NOTHING
      RETURNING position_id, source_rebalance_decision_id
    ),
    latest_projected_rebalance AS (
      SELECT DISTINCT ON (event.position_id)
        event.position_id,
        event.source_rebalance_decision_id
      FROM loyal_yield.user_yield_position_holding_events event
      INNER JOIN candidate_events candidate
        ON candidate.position_id = event.position_id
       AND candidate.decision_id = event.source_rebalance_decision_id
      WHERE event.source_rebalance_decision_id IS NOT NULL
      ORDER BY event.position_id, event.source_rebalance_decision_id DESC
    ),
    updated_positions AS (
      UPDATE loyal_yield.user_yield_positions position
      SET
        last_rebalance_decision_id =
          latest_projected_rebalance.source_rebalance_decision_id,
        updated_at = ${now}
      FROM latest_projected_rebalance
      WHERE position.id = latest_projected_rebalance.position_id
        AND (
          position.last_rebalance_decision_id IS NULL
          OR position.last_rebalance_decision_id <
            latest_projected_rebalance.source_rebalance_decision_id
        )
      RETURNING position.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM inserted_events) AS "insertedCount",
      (SELECT COUNT(*)::int FROM updated_positions) AS "updatedPositionCount"
  `);
  const [row] = getExecuteRows(queryResult);

  return {
    insertedCount: readExecuteCount(
      row?.insertedCount ?? row?.inserted_count
    ),
    updatedPositionCount: readExecuteCount(
      row?.updatedPositionCount ?? row?.updated_position_count
    ),
  };
}

export async function recordSnapshotReconciledYieldHolding(
  input: SnapshotReconciliationInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<UserYieldPositionRecord> {
  const now = dependencies.now();
  const observedAt = input.observedAt ?? now;
  const event = await insertHoldingEvent({
    amountRaw: input.amountRaw,
    client: dependencies.client,
    createdAt: now,
    eventType: "snapshot_reconciled",
    holdingDeltaRaw: null,
    liquidityMint: input.liquidityMint,
    market: input.market,
    observedAt,
    observedSlot: input.observedSlot,
    positionId: input.positionId,
    principalDeltaRaw: null,
    reserve: input.reserve,
    sourceSignature: null,
    sourceSnapshotId: input.sourceSnapshotId,
  });

  return applyHoldingEventToPosition({
    client: dependencies.client,
    event,
    now,
  });
}

function sortHoldingEventsAscending(
  events: UserYieldPositionHoldingEventRecord[]
): UserYieldPositionHoldingEventRecord[] {
  return [...events].sort((a, b) => {
    if (a.observedSlot !== b.observedSlot) {
      return a.observedSlot < b.observedSlot ? -1 : 1;
    }

    const observedAtDelta = a.observedAt.getTime() - b.observedAt.getTime();
    if (observedAtDelta !== 0) {
      return observedAtDelta;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function hasHoldingEventProvenance(
  event: Pick<
    UserYieldPositionHoldingEventRecord,
    | "sourceDepositId"
    | "sourceRebalanceDecisionId"
    | "sourceSignature"
    | "sourceSnapshotId"
    | "sourceWithdrawalId"
  >
): boolean {
  return Boolean(
    event.sourceSignature ||
      event.sourceDepositId ||
      event.sourceWithdrawalId ||
      event.sourceRebalanceDecisionId ||
      event.sourceSnapshotId
  );
}

function buildVerificationFailure(args: {
  position: UserYieldPositionRecord;
  reason: YieldPositionVerificationFailureReason;
  expectedPrincipalAmountRaw: bigint;
  currentEvent: UserYieldPositionHoldingEventRecord | null;
}): YieldPositionVerificationFailure {
  return {
    expectedCurrentHolding: {
      amountRaw: args.currentEvent?.amountRaw ?? null,
      lastHoldingEventId: args.currentEvent?.id ?? null,
      liquidityMint: args.currentEvent?.liquidityMint ?? null,
      market: args.currentEvent?.market ?? null,
      observedAt: args.currentEvent?.observedAt ?? null,
      observedSlot: args.currentEvent?.observedSlot ?? null,
      reserve: args.currentEvent?.reserve ?? null,
    },
    expectedPrincipalAmountRaw: args.expectedPrincipalAmountRaw,
    positionId: args.position.id,
    reason: args.reason,
    settings: args.position.settings,
    storedCurrentHolding: {
      amountRaw: args.position.currentAmountRaw,
      lastHoldingEventId: args.position.lastHoldingEventId,
      liquidityMint: args.position.currentLiquidityMint,
      market: args.position.currentMarket,
      observedAt: args.position.currentObservedAt,
      observedSlot: args.position.currentObservedSlot,
      reserve: args.position.currentReserve,
    },
    storedPrincipalAmountRaw: args.position.principalAmountRaw,
    walletAddress: args.position.walletAddress,
  };
}

function applyPrincipalEventForVerification(
  principal: bigint,
  event: UserYieldPositionHoldingEventRecord,
  withdrawalById: Map<
    bigint,
    Pick<UserYieldPositionWithdrawalRecord, "mode" | "sourceType">
  >
): bigint {
  switch (event.eventType) {
    case "deposit_initialized":
    case "deposit_top_up":
      return principal + (event.principalDeltaRaw ?? BigInt(0));
    case "withdrawal_partial": {
      const withdrawal =
        event.sourceWithdrawalId === null
          ? null
          : withdrawalById.get(event.sourceWithdrawalId) ?? null;
      if (withdrawal?.sourceType === "idle") {
        return principal;
      }
      if (withdrawal?.mode === "full") {
        return BigInt(0);
      }
      return principal + (event.principalDeltaRaw ?? BigInt(0));
    }
    case "withdrawal_full":
      return BigInt(0);
    case "rebalance_confirmed":
    case "snapshot_reconciled":
      return principal;
  }
}

export async function verifyUserYieldPositions(
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<YieldPositionVerificationFailure[]> {
  const positions = await dependencies.client.db
    .select()
    .from(userYieldPositions);
  const failures: YieldPositionVerificationFailure[] = [];

  for (const position of positions) {
    const [deposits, withdrawals, holdingEvents] =
      await dependencies.client.db.batch([
        dependencies.client.db
          .select({
            amountRaw: userYieldPositionDeposits.principalAmountRaw,
          })
          .from(userYieldPositionDeposits)
          .where(
            and(
              eq(userYieldPositionDeposits.settings, position.settings),
              eq(userYieldPositionDeposits.vaultIndex, position.vaultIndex),
              eq(
                userYieldPositionDeposits.walletAddress,
                position.walletAddress
              )
            )
          ),
        dependencies.client.db
          .select({
            id: userYieldPositionWithdrawals.id,
            mode: userYieldPositionWithdrawals.mode,
            sourceType: userYieldPositionWithdrawals.sourceType,
            withdrawnAmountRaw: userYieldPositionWithdrawals.withdrawnAmountRaw,
          })
          .from(userYieldPositionWithdrawals)
          .where(
            and(
              eq(userYieldPositionWithdrawals.settings, position.settings),
              eq(userYieldPositionWithdrawals.vaultIndex, position.vaultIndex),
              eq(
                userYieldPositionWithdrawals.walletAddress,
                position.walletAddress
              )
            )
          ),
        dependencies.client.db
          .select()
          .from(userYieldPositionHoldingEvents)
          .where(
            and(eq(userYieldPositionHoldingEvents.positionId, position.id))
          ),
      ]);
    const sortedHoldingEvents = sortHoldingEventsAscending(
      holdingEvents as UserYieldPositionHoldingEventRecord[]
    );
    const latestEvent =
      sortedHoldingEvents[sortedHoldingEvents.length - 1] ?? null;
    const currentEvent =
      position.lastHoldingEventId === null
        ? latestEvent
        : sortedHoldingEvents.find(
            (event) => event.id === position.lastHoldingEventId
          ) ?? null;
    const withdrawalById = new Map(
      withdrawals.map((withdrawal) => [withdrawal.id, withdrawal])
    );
    const expectedPrincipalAmountRaw =
      sortedHoldingEvents.length > 0
        ? sortedHoldingEvents.reduce(
            (principal, event) =>
              applyPrincipalEventForVerification(
                principal,
                event,
                withdrawalById
              ),
            BigInt(0)
          )
        : deposits.reduce(
            (total, deposit) => total + deposit.amountRaw,
            BigInt(0)
          ) -
          withdrawals.reduce(
            (total, withdrawal) => total + withdrawal.withdrawnAmountRaw,
            BigInt(0)
          );

    if (position.principalAmountRaw < BigInt(0)) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          currentEvent,
          position,
          reason: "negative_principal",
        })
      );
    }
    if (position.currentAmountRaw < BigInt(0)) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          currentEvent,
          position,
          reason: "negative_holding",
        })
      );
    }
    if (!latestEvent) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          currentEvent,
          position,
          reason: "missing_holding_events",
        })
      );
      continue;
    }
    if (
      sortedHoldingEvents.some((event) => !hasHoldingEventProvenance(event))
    ) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          currentEvent,
          position,
          reason: "missing_provenance",
        })
      );
    }
    if (position.principalAmountRaw !== expectedPrincipalAmountRaw) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          currentEvent,
          position,
          reason: "principal_mismatch",
        })
      );
    }
    if (
      currentEvent === null ||
      position.currentReserve !== currentEvent.reserve ||
      position.currentMarket !== currentEvent.market ||
      position.currentLiquidityMint !== currentEvent.liquidityMint ||
      position.currentAmountRaw !== currentEvent.amountRaw ||
      position.currentObservedSlot !== currentEvent.observedSlot ||
      position.currentObservedAt.getTime() !== currentEvent.observedAt.getTime()
    ) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          currentEvent,
          position,
          reason: "current_projection_mismatch",
        })
      );
    }
    if (
      position.lastHoldingEventId === null ||
      currentEvent?.id !== position.lastHoldingEventId
    ) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          currentEvent,
          position,
          reason: "stale_last_holding_event",
        })
      );
    }
    if (position.lastRebalanceDecisionId) {
      const [decision] = await dependencies.client.db
        .select({ status: rebalanceDecisions.status })
        .from(rebalanceDecisions)
        .where(eq(rebalanceDecisions.id, position.lastRebalanceDecisionId));
      if (decision?.status !== "confirmed") {
        failures.push(
          buildVerificationFailure({
            expectedPrincipalAmountRaw,
            currentEvent,
            position,
            reason: "rebalance_decision_not_confirmed",
          })
        );
      }
    }
  }

  return failures;
}
