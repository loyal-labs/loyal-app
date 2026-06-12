import "server-only";

import {
  RiskBasket,
  createVaultYieldRoutingPolicyPlan,
  normalizeLoyalCluster,
  type VaultYieldRoutingPolicyPlan,
} from "@loyal-labs/actions";
import { PublicKey } from "@solana/web3.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  getYieldOptimizationClient,
  managedVaults,
  rebalanceDecisions,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositionHoldingEvents,
  userYieldPositionWithdrawals,
  userYieldPositions,
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

function createYieldRoutingPolicyPlanFromRouteInput(
  input: ConfirmedYieldRoutePolicyInput
): VaultYieldRoutingPolicyPlan {
  return createVaultYieldRoutingPolicyPlan({
    cluster: normalizeLoyalCluster(input.cluster),
    policySeed: input.policySeed,
    risk: RiskBasket.Safe,
    smartAccount: {
      settings: new PublicKey(input.settings),
      authority: new PublicKey(input.walletAddress),
      delegatedSigner: new PublicKey(input.delegatedSigner),
    },
    vaultIndex: input.vaultIndex,
  });
}

export function createRoutePolicyValuesFromPlan(
  plan: VaultYieldRoutingPolicyPlan,
  input: ConfirmedYieldRoutePolicyInput,
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
  const routePolicyValues = createRoutePolicyValuesFromPlan(
    routePolicyPlan,
    input,
    now
  );
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
        lastSeenSlot: input.confirmedSlot,
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

  const managedVaultValues = {
    active: true,
    activePolicyId: routePolicy.id,
    firstSeenAt: now,
    lastSeenAt: now,
    settings: input.settings,
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

  const { client } = dependencies;
  const now = dependencies.now();
  const existingPosition =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.initialReserve, input.targetReserve)
      ),
    });

  const isDuplicateInitialDeposit =
    existingPosition?.firstDepositSignature === input.depositSignature ||
    existingPosition?.lastDepositSignature === input.depositSignature;
  if (
    input.policyInitialization === "create" &&
    existingPosition?.status === "active" &&
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
    const position = await upsertAggregatePosition({
      client,
      input,
      mode: hasActiveExistingPosition
        ? "increment-principal"
        : "recover-principal",
      now,
    });
    const sameCurrentHolding =
      !hasActiveExistingPosition ||
      (existingPosition.currentReserve === input.targetReserve &&
        existingPosition.currentLiquidityMint === input.liquidityMint);
    const nextCurrentAmountRaw = hasActiveExistingPosition
      ? sameCurrentHolding
        ? existingPosition.currentAmountRaw + input.principalAmountRaw
        : existingPosition.currentAmountRaw
      : input.principalAmountRaw;
    const event = await insertHoldingEvent({
      amountRaw: nextCurrentAmountRaw,
      client,
      createdAt: now,
      eventType: hasActiveExistingPosition
        ? "deposit_top_up"
        : "deposit_initialized",
      holdingDeltaRaw: sameCurrentHolding ? input.principalAmountRaw : null,
      liquidityMint:
        hasActiveExistingPosition && existingPosition
          ? existingPosition.currentLiquidityMint
          : input.liquidityMint,
      market:
        hasActiveExistingPosition && existingPosition
          ? existingPosition.currentMarket
          : input.market,
      observedAt: now,
      observedSlot: input.confirmedSlot,
      positionId: position.id,
      principalDeltaRaw: input.principalAmountRaw,
      reserve:
        hasActiveExistingPosition && existingPosition
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
      principalAmountRaw: position.principalAmountRaw,
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
    });

  return position ?? null;
}

export async function findActiveYieldRoutePolicy(input: {
  authority: string;
  cluster: string;
  settings: string;
  vaultIndex: number;
}): Promise<RoutePolicyRecord | null> {
  const client = getYieldOptimizationClient();
  const policy = await client.db.query.routePolicies.findFirst({
    where: and(
      eq(routePolicies.authority, input.authority),
      eq(routePolicies.settings, input.settings),
      eq(routePolicies.vaultIndex, input.vaultIndex),
      eq(routePolicies.active, true)
    ),
    orderBy: [desc(routePolicies.id)],
  });

  return policy ?? null;
}

export async function findYieldPositionEvents(
  input: YieldPositionEventsLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionEventRecord[]> {
  const depositFilters = [
    eq(userYieldPositionDeposits.settings, input.settings),
    eq(userYieldPositionDeposits.targetReserve, input.initialReserve),
    eq(userYieldPositionDeposits.vaultIndex, input.vaultIndex),
    eq(userYieldPositionDeposits.walletAddress, input.walletAddress),
  ];
  const withdrawalFilters = [
    eq(userYieldPositionWithdrawals.settings, input.settings),
    eq(userYieldPositionWithdrawals.targetReserve, input.initialReserve),
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
  const existingPosition = await client.db.query.userYieldPositions.findFirst({
    where: and(
      eq(userYieldPositions.settings, input.settings),
      eq(userYieldPositions.vaultIndex, input.vaultIndex),
      eq(userYieldPositions.initialReserve, input.targetReserve)
    ),
  });

  if (!existingPosition) {
    throw new Error("No active yield position exists for this withdrawal.");
  }
  if (existingPosition.status !== "active") {
    throw new Error("Yield position is not active.");
  }
  if (existingPosition.principalAmountRaw < input.withdrawnAmountRaw) {
    throw new Error("Withdrawal exceeds the active yield position amount.");
  }
  if (existingPosition.currentAmountRaw < input.withdrawnAmountRaw) {
    throw new Error("Withdrawal exceeds the current yield holding amount.");
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
    holdingDeltaRaw: -input.withdrawnAmountRaw,
    liquidityMint: existingPosition.currentLiquidityMint,
    market: existingPosition.currentMarket,
    observedAt: now,
    observedSlot: input.confirmedSlot,
    positionId: existingPosition.id,
    principalDeltaRaw: -input.withdrawnAmountRaw,
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
    await client.db.batch([
      client.db
        .update(routePolicies)
        .set({
          active: false,
          lastSeenAt: now,
          lastSeenSignature: input.withdrawalSignature,
          lastSeenSlot: input.confirmedSlot,
        })
        .where(
          and(
            eq(routePolicies.settings, input.settings),
            eq(routePolicies.vaultIndex, input.vaultIndex)
          )
        ) as never,
      client.db
        .update(managedVaults)
        .set({ active: false, lastSeenAt: now })
        .where(
          and(
            eq(managedVaults.settings, input.settings),
            eq(managedVaults.vaultIndex, input.vaultIndex)
          )
        ) as never,
    ]);
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
                userYieldPositionDeposits.targetReserve,
                position.initialReserve
              ),
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
                userYieldPositionWithdrawals.targetReserve,
                position.initialReserve
              ),
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
    const expectedPrincipalAmountRaw =
      deposits.reduce(
        (total, deposit) => total + deposit.amountRaw,
        BigInt(0)
      ) -
      withdrawals.reduce(
        (total, withdrawal) => total + withdrawal.amountRaw,
        BigInt(0)
      );
    const sortedHoldingEvents = sortHoldingEventsAscending(
      holdingEvents as UserYieldPositionHoldingEventRecord[]
    );
    const latestEvent =
      sortedHoldingEvents[sortedHoldingEvents.length - 1] ?? null;

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
