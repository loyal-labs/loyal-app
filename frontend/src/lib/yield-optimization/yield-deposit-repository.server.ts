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
  getYieldOptimizationClient,
  managedVaults,
  rebalanceDecisions,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositionHoldingEvents,
  userYieldPositionWithdrawals,
  userYieldPositions,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  vaultReservePositionsCurrent,
  type YieldOptimizationClient,
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
  liquidityMint: string;
  sourceReserve?: string | null;
  destinationReserve?: string | null;
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

export type YieldPositionEventsLookupInput = ActiveYieldPositionLookupInput & {
  vaultPubkey?: string;
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
  autodepositClose?: ConfirmedYieldWithdrawalAutodepositCloseInput | null;
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

type YieldDepositRepositoryDependencies = {
  client: YieldOptimizationClient;
  now: () => Date;
};

type AggregatePositionUpsertMode = "increment-principal" | "recover-principal";

function createDependencies(): YieldDepositRepositoryDependencies {
  return {
    client: getYieldOptimizationClient(),
    now: () => new Date(),
  };
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
    dependencies.client.db
      .insert(vaultPositionSnapshotPositions)
      .values(
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

  await dependencies.client.db.batch([
    ...(policyIds.length > 0
      ? [
          dependencies.client.db
            .update(routePolicies)
            .set({
              active: false,
              lastSeenAt: now,
              lastSeenSignature: input.withdrawalSignature,
              lastSeenSlot: input.confirmedSlot,
            })
            .where(inArray(routePolicies.id, policyIds)) as never,
        ]
      : []),
    dependencies.client.db
      .update(managedVaults)
      .set({ active: false, lastSeenAt: now })
      .where(eq(managedVaults.id, vault.id)) as never,
  ]);
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

async function findIdempotentDepositPosition(
  input: ConfirmedYieldDepositInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">
): Promise<UserYieldPositionRecord | null> {
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
    input.smartAccountAddress,
    "smartAccountAddress"
  );
  assertDuplicateDepositField(deposit.settings, input.settings, "settings");
  assertDuplicateDepositField(deposit.vaultIndex, input.vaultIndex, "vaultIndex");
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
  assertDuplicateDepositField(deposit.policySeed, input.policySeed, "policySeed");
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
  assertDuplicateDepositField(deposit.depositMint, input.depositMint, "depositMint");
  assertDuplicateDepositField(
    deposit.principalAmountRaw,
    input.principalAmountRaw,
    "principalAmountRaw"
  );

  const event =
    await dependencies.client.db.query.userYieldPositionHoldingEvents.findFirst({
      orderBy: [
        desc(userYieldPositionHoldingEvents.observedSlot),
        desc(userYieldPositionHoldingEvents.id),
      ],
      where: eq(userYieldPositionHoldingEvents.sourceDepositId, deposit.id),
    });
  if (event) {
    const position =
      await dependencies.client.db.query.userYieldPositions.findFirst({
        where: eq(userYieldPositions.id, event.positionId),
      });
    if (position) {
      return position;
    }
  }

  const position =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress),
        eq(userYieldPositions.vaultPubkey, input.vaultPubkey),
        eq(userYieldPositions.lastDepositSignature, input.depositSignature)
      ),
      orderBy: [desc(userYieldPositions.updatedAt), desc(userYieldPositions.id)],
    });

  if (!position) {
    throw new Error("Duplicate deposit position is missing.");
  }

  return position;
}

async function findIdempotentWithdrawalPosition(
  input: ConfirmedYieldWithdrawalInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client">
): Promise<UserYieldPositionRecord | null> {
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
    input.smartAccountAddress,
    "smartAccountAddress"
  );
  assertDuplicateWithdrawalField(withdrawal.settings, input.settings, "settings");
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

  const position =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress),
        eq(userYieldPositions.vaultPubkey, input.vaultPubkey)
      ),
      orderBy: [desc(userYieldPositions.updatedAt), desc(userYieldPositions.id)],
    });

  if (!position) {
    throw new Error("Duplicate withdrawal position is missing.");
  }

  return position;
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
}): Promise<RoutePolicyRecord> {
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

  const managedVaultValues = {
    active: true,
    activePolicyId: routePolicy.id,
    firstSeenAt: now,
    lastSeenAt: now,
    settings: input.settings,
    ...(setupPolicy ? { setupPolicyId: setupPolicy.id } : {}),
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
        ...(setupPolicy ? { setupPolicyId: setupPolicy.id } : {}),
      },
    });

  return routePolicy;
}

async function upsertAggregatePosition(args: {
  client: YieldOptimizationClient;
  input: ConfirmedYieldDepositInput;
  mode: AggregatePositionUpsertMode;
  now: Date;
}): Promise<UserYieldPositionRecord> {
  const { client, input, mode, now } = args;
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
      smartAccountAddress: input.smartAccountAddress,
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
        smartAccountAddress: input.smartAccountAddress,
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

  const idempotentPosition = await findIdempotentDepositPosition(
    input,
    dependencies
  );
  if (idempotentPosition) {
    return idempotentPosition;
  }

  const { client } = dependencies;
  const now = dependencies.now();
  const activeVaultPosition = await findReconciledActiveYieldPositionForVault(
    {
      cluster: input.cluster,
      settings: input.settings,
      vaultIndex: input.vaultIndex,
      walletAddress: input.walletAddress,
    },
    dependencies
  );
  const reservePosition =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.initialReserve, input.targetReserve),
        eq(userYieldPositions.walletAddress, input.walletAddress)
      ),
      orderBy: [desc(userYieldPositions.id)],
    });
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
    smartAccountAddress: input.smartAccountAddress,
    targetReserve: input.targetReserve,
    targetSupplyApyBps: input.targetSupplyApyBps,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
  };

  const insertedDeposits = await client.db
    .insert(userYieldPositionDeposits)
    .values(depositValues)
    .onConflictDoNothing({
      target: [userYieldPositionDeposits.depositSignature],
    })
    .returning({ id: userYieldPositionDeposits.id });

  if (insertedDeposits.length > 0) {
    const [insertedDeposit] = insertedDeposits;
    const position =
      hasActiveExistingPosition && existingPosition
        ? existingPosition
        : await upsertAggregatePosition({
            client,
            input,
            mode: "recover-principal",
            now,
          });
    const sameCurrentHolding =
      !hasActiveExistingPosition ||
      (existingPosition.currentReserve === input.targetReserve &&
        existingPosition.currentMarket === input.market &&
        existingPosition.currentLiquidityMint === input.liquidityMint);
    const nextCurrentAmountRaw = hasActiveExistingPosition
      ? sameCurrentHolding
        ? existingPosition.currentAmountRaw + input.principalAmountRaw
        : input.principalAmountRaw
      : input.principalAmountRaw;
    const event = await insertHoldingEvent({
      amountRaw: nextCurrentAmountRaw,
      client,
      createdAt: now,
      eventType: hasActiveExistingPosition
        ? "deposit_top_up"
        : "deposit_initialized",
      holdingDeltaRaw: input.principalAmountRaw,
      liquidityMint:
        hasActiveExistingPosition && existingPosition && sameCurrentHolding
          ? existingPosition.currentLiquidityMint
          : input.liquidityMint,
      market:
        hasActiveExistingPosition && existingPosition && sameCurrentHolding
          ? existingPosition.currentMarket
          : input.market,
      observedAt: now,
      observedSlot: input.confirmedSlot,
      positionId: position.id,
      principalDeltaRaw: input.principalAmountRaw,
      reserve:
        hasActiveExistingPosition && existingPosition && sameCurrentHolding
          ? existingPosition.currentReserve
          : input.targetReserve,
      sourceDepositId: insertedDeposit.id,
      sourceSignature: input.depositSignature,
    });

    return applyHoldingEventToPosition({
      client,
      event,
      lastConfirmedSlot: input.confirmedSlot,
      lastDepositSignature: input.depositSignature,
      now,
      principalAmountRaw: hasActiveExistingPosition
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

  return upsertConfirmedYieldRoutePolicy({
    client,
    input,
    now,
  });
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
      orderBy: [desc(userYieldPositions.updatedAt), desc(userYieldPositions.id)],
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
      orderBy: [desc(userYieldPositions.updatedAt), desc(userYieldPositions.id)],
    });

  return position ?? null;
}

export async function findReconciledActiveYieldPositionForVault(
  input: ActiveYieldPositionForVaultLookupInput,
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

  const [current] = await dependencies.client.db
    .select()
    .from(vaultReservePositionsCurrent)
    .where(
      and(
        eq(vaultReservePositionsCurrent.vaultId, vault.id),
        eq(vaultReservePositionsCurrent.hasValue, true),
        sql`${vaultReservePositionsCurrent.amountRaw} > 0`
      )
    )
    .orderBy(
      desc(vaultReservePositionsCurrent.observedSlot),
      desc(vaultReservePositionsCurrent.amountRaw),
      desc(vaultReservePositionsCurrent.snapshotId)
    )
    .limit(1);

  if (!current) {
    return position;
  }
  if (current.observedSlot <= position.currentObservedSlot) {
    return position;
  }

  const latestEvent = await findLatestHoldingEventForPosition(
    position.id,
    dependencies
  );
  if (
    latestEvent &&
    currentVaultPositionMatchesEvent(current, latestEvent)
  ) {
    if (currentPositionMatchesHoldingEvent(position, latestEvent)) {
      return position;
    }

    return applyHoldingEventToPosition({
      client: dependencies.client,
      event: latestEvent,
      now: dependencies.now(),
    });
  }

  const decision = await dependencies.client.db.query.rebalanceDecisions.findFirst(
    {
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
    }
  );

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

export async function findActiveYieldRoutePolicyPair(input: {
  authority: string;
  cluster: string;
  settings: string;
  vaultIndex: number;
  vaultPubkey?: string;
}): Promise<ActiveYieldRoutePolicyPair | null> {
  const client = getYieldOptimizationClient();
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

  return chronologicalEvents
    .map((event) => {
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
      previousReserve = event.reserve;

      return {
        amountRaw: event.amountRaw,
        confirmedAt: event.confirmedAt,
        confirmedSlot: event.confirmedSlot,
        destinationReserve:
          type === "rebalance" || type === "reconciliation"
            ? event.reserve
            : null,
        eventType: event.eventType,
        id: event.id,
        liquidityMint: event.liquidityMint,
        market: event.market,
        principalDeltaRaw: event.principalDeltaRaw,
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
        sourceReserve: sourceReserve,
        type,
      };
    })
    .sort((a, b) => {
      const confirmedAtDelta =
        b.confirmedAt.getTime() - a.confirmedAt.getTime();
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
  const idempotentPosition = await findIdempotentWithdrawalPosition(
    input,
    dependencies
  );
  if (idempotentPosition) {
    if (input.mode === "full") {
      await recordZeroCurrentVaultPositionsAfterFullWithdrawal(input, dependencies);
      await deactivateVaultAfterFullWithdrawal(input, dependencies, now);
    }
    return idempotentPosition;
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
  if (existingPosition.principalAmountRaw < input.withdrawnAmountRaw) {
    throw new Error("Withdrawal exceeds the active yield position amount.");
  }
  if (
    input.mode === "partial" &&
    existingPosition.currentAmountRaw < input.withdrawnAmountRaw
  ) {
    throw new Error("Withdrawal exceeds the current yield holding amount.");
  }
  if (
    existingPosition.currentReserve !== input.targetReserve ||
    existingPosition.currentLiquidityMint !== input.liquidityMint ||
    existingPosition.currentMarket !== input.market
  ) {
    throw new Error(
      "Withdrawal target does not match the current Earn holding."
    );
  }

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
    settings: input.settings,
    smartAccountAddress: input.smartAccountAddress,
    targetReserve: input.targetReserve,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
    walletAddress: input.walletAddress,
    withdrawalSignature: input.withdrawalSignature,
    withdrawnAmountRaw: input.withdrawnAmountRaw,
  };
  const nextPrincipal =
    input.mode === "full"
      ? BigInt(0)
      : existingPosition.principalAmountRaw - input.withdrawnAmountRaw;
  const insertedWithdrawals = await client.db
    .insert(userYieldPositionWithdrawals)
    .values(withdrawalValues)
    .onConflictDoNothing({
      target: [userYieldPositionWithdrawals.withdrawalSignature],
    })
    .returning({ id: userYieldPositionWithdrawals.id });

  if (insertedWithdrawals.length === 0) {
    return existingPosition;
  }

  const [insertedWithdrawal] = insertedWithdrawals;
  const nextHoldingAmountRaw =
    input.mode === "full"
      ? BigInt(0)
      : existingPosition.currentAmountRaw - input.withdrawnAmountRaw;
  const event = await insertHoldingEvent({
    amountRaw: nextHoldingAmountRaw,
    client,
    createdAt: now,
    eventType: input.mode === "full" ? "withdrawal_full" : "withdrawal_partial",
    holdingDeltaRaw:
      input.mode === "full"
        ? -existingPosition.currentAmountRaw
        : -input.withdrawnAmountRaw,
    liquidityMint: existingPosition.currentLiquidityMint,
    market: existingPosition.currentMarket,
    observedAt: now,
    observedSlot: input.confirmedSlot,
    positionId: existingPosition.id,
    principalDeltaRaw:
      input.mode === "full"
        ? -existingPosition.principalAmountRaw
        : -input.withdrawnAmountRaw,
    reserve: existingPosition.currentReserve,
    sourceSignature: input.withdrawalSignature,
    sourceWithdrawalId: insertedWithdrawal.id,
  });

  const position = await applyHoldingEventToPosition({
    client,
    event,
    lastConfirmedSlot: input.confirmedSlot,
    now,
    principalAmountRaw:
      input.mode === "full"
        ? BigInt(0)
        : sql`${userYieldPositions.principalAmountRaw} - ${input.withdrawnAmountRaw}`,
    status: input.mode === "full" ? "closed" : "active",
  });

  if (input.mode === "full") {
    await recordZeroCurrentVaultPositionsAfterFullWithdrawal(input, dependencies);
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
  const event = await insertHoldingEvent({
    amountRaw: input.amountRaw,
    client: dependencies.client,
    createdAt: now,
    eventType: "rebalance_confirmed",
    holdingDeltaRaw: null,
    liquidityMint: input.liquidityMint,
    market: input.market,
    observedAt,
    observedSlot: input.observedSlot,
    positionId: input.positionId,
    principalDeltaRaw: null,
    reserve: input.reserve,
    sourceRebalanceDecisionId: input.sourceRebalanceDecisionId,
    sourceSignature: input.sourceSignature,
    sourceSnapshotId: input.sourceSnapshotId,
  });

  return applyHoldingEventToPosition({
    client: dependencies.client,
    event,
    lastRebalanceDecisionId: input.sourceRebalanceDecisionId,
    now,
  });
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
  latestEvent: UserYieldPositionHoldingEventRecord | null;
}): YieldPositionVerificationFailure {
  return {
    expectedCurrentHolding: {
      amountRaw: args.latestEvent?.amountRaw ?? null,
      lastHoldingEventId: args.latestEvent?.id ?? null,
      liquidityMint: args.latestEvent?.liquidityMint ?? null,
      market: args.latestEvent?.market ?? null,
      observedAt: args.latestEvent?.observedAt ?? null,
      observedSlot: args.latestEvent?.observedSlot ?? null,
      reserve: args.latestEvent?.reserve ?? null,
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
            amountRaw: userYieldPositionWithdrawals.withdrawnAmountRaw,
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
    const expectedPrincipalAmountRaw =
      sortedHoldingEvents.length > 0
        ? sortedHoldingEvents.reduce((principal, event) => {
            if (event.eventType === "withdrawal_full") {
              return BigInt(0);
            }
            return principal + (event.principalDeltaRaw ?? BigInt(0));
          }, BigInt(0))
        : deposits.reduce(
            (total, deposit) => total + deposit.amountRaw,
            BigInt(0)
          ) -
          withdrawals.reduce(
            (total, withdrawal) => total + withdrawal.amountRaw,
            BigInt(0)
          );

    if (position.principalAmountRaw < BigInt(0)) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          latestEvent,
          position,
          reason: "negative_principal",
        })
      );
    }
    if (position.currentAmountRaw < BigInt(0)) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          latestEvent,
          position,
          reason: "negative_holding",
        })
      );
    }
    if (!latestEvent) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          latestEvent,
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
          latestEvent,
          position,
          reason: "missing_provenance",
        })
      );
    }
    if (position.principalAmountRaw !== expectedPrincipalAmountRaw) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          latestEvent,
          position,
          reason: "principal_mismatch",
        })
      );
    }
    if (
      position.currentReserve !== latestEvent.reserve ||
      position.currentMarket !== latestEvent.market ||
      position.currentLiquidityMint !== latestEvent.liquidityMint ||
      position.currentAmountRaw !== latestEvent.amountRaw ||
      position.currentObservedSlot !== latestEvent.observedSlot ||
      position.currentObservedAt.getTime() !== latestEvent.observedAt.getTime()
    ) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          latestEvent,
          position,
          reason: "current_projection_mismatch",
        })
      );
    }
    if (position.lastHoldingEventId !== latestEvent.id) {
      failures.push(
        buildVerificationFailure({
          expectedPrincipalAmountRaw,
          latestEvent,
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
            latestEvent,
            position,
            reason: "rebalance_decision_not_confirmed",
          })
        );
      }
    }
  }

  return failures;
}
