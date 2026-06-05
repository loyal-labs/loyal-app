import "server-only";

import {
  LoyalCluster,
  RiskBasket,
  createVaultYieldRoutingPolicyPlan,
  type VaultYieldRoutingPolicyPlan,
} from "@loyal/actions";
import { PublicKey } from "@solana/web3.js";
import { and, asc, eq, gte, sql } from "drizzle-orm";

import {
  getYieldOptimizationClient,
  managedVaults,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositionWithdrawals,
  userYieldPositions,
  type YieldOptimizationClient,
} from "./yield-neon-client.server";

export type ConfirmedYieldDepositInput = {
  cluster: string;
  walletAddress: string;
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

export type UserYieldPositionRecord = typeof userYieldPositions.$inferSelect;
export type RoutePolicyRecord = typeof routePolicies.$inferSelect;
export type UserYieldPositionEventRecord = {
  amountRaw: bigint;
  confirmedAt: Date;
  type: "deposit" | "withdrawal";
};

export type ActiveYieldPositionLookupInput = {
  cluster: string;
  settings: string;
  targetReserve: string;
  vaultIndex: number;
  walletAddress: string;
};

export type YieldPositionEventsLookupInput = ActiveYieldPositionLookupInput & {
  vaultPubkey?: string;
};

export type ConfirmedYieldWithdrawalInput = {
  cluster: string;
  walletAddress: string;
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

function parseLoyalCluster(cluster: string): LoyalCluster {
  if (cluster === LoyalCluster.Devnet) {
    return LoyalCluster.Devnet;
  }
  if (cluster === LoyalCluster.MainnetBeta || cluster === "mainnet") {
    return LoyalCluster.MainnetBeta;
  }
  throw new Error(`unsupported Loyal cluster: ${cluster}`);
}

function createYieldRoutingPolicyPlanFromDepositInput(
  input: ConfirmedYieldDepositInput
): VaultYieldRoutingPolicyPlan {
  return createVaultYieldRoutingPolicyPlan({
    cluster: parseLoyalCluster(input.cluster),
    risk: RiskBasket.Safe,
    smartAccount: {
      settings: new PublicKey(input.settings),
      authority: new PublicKey(input.walletAddress),
      delegatedSigner: new PublicKey(input.walletAddress),
    },
    vaultIndex: input.vaultIndex,
  });
}

export function createRoutePolicyValuesFromPlan(
  plan: VaultYieldRoutingPolicyPlan,
  input: ConfirmedYieldDepositInput,
  now: Date
) {
  return {
    active: true,
    authority: input.walletAddress,
    cluster: input.cluster,
    delegatedSigners: [input.walletAddress],
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
      cluster: input.cluster,
      createdAt: now,
      depositMint: input.depositMint,
      firstDepositSignature: input.depositSignature,
      lastConfirmedSlot: input.confirmedSlot,
      lastDepositSignature: input.depositSignature,
      liquidityMint: input.liquidityMint,
      market: input.market,
      policyAccount: input.policyAccount,
      policyId: input.policyId,
      policySeed: input.policySeed,
      principalAmountRaw: input.principalAmountRaw,
      settings: input.settings,
      smartAccountAddress: input.smartAccountAddress,
      status: "active",
      targetReserve: input.targetReserve,
      targetSupplyApyBps: input.targetSupplyApyBps,
      updatedAt: now,
      vaultIndex: input.vaultIndex,
      vaultPubkey: input.vaultPubkey,
      walletAddress: input.walletAddress,
    })
    .onConflictDoUpdate({
      target: [
        userYieldPositions.cluster,
        userYieldPositions.settings,
        userYieldPositions.vaultIndex,
        userYieldPositions.targetReserve,
      ],
      set: {
        depositMint: input.depositMint,
        firstDepositSignature,
        lastConfirmedSlot: input.confirmedSlot,
        lastDepositSignature: input.depositSignature,
        liquidityMint: input.liquidityMint,
        market: input.market,
        policyAccount: input.policyAccount,
        policyId: input.policyId,
        policySeed: input.policySeed,
        principalAmountRaw,
        smartAccountAddress: input.smartAccountAddress,
        status: "active",
        targetSupplyApyBps: input.targetSupplyApyBps,
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
        eq(userYieldPositions.cluster, input.cluster),
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.targetReserve, input.targetReserve)
      ),
    });

  if (input.policyInitialization === "reuse" && !existingPosition) {
    throw new Error("Top-up yield deposit requires an existing active position.");
  }
  if (
    input.policyInitialization === "reuse" &&
    existingPosition?.status !== "active"
  ) {
    throw new Error("Top-up yield deposit requires an active yield position.");
  }
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

  const routePolicyPlan = createYieldRoutingPolicyPlanFromDepositInput(input);
  const routePolicyValues = createRoutePolicyValuesFromPlan(
    routePolicyPlan,
    input,
    now
  );
  const [routePolicy] = await client.db
    .insert(routePolicies)
    .values(routePolicyValues)
    .onConflictDoUpdate({
      target: [routePolicies.cluster, routePolicies.policyAccount],
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
    .returning({ id: routePolicies.id });

  if (!routePolicy) {
    throw new Error("Failed to record confirmed yield route policy.");
  }

  const managedVaultValues = {
    active: true,
    activePolicyId: routePolicy.id,
    cluster: input.cluster,
    firstSeenAt: now,
    lastSeenAt: now,
    settings: input.settings,
    vaultIndex: routePolicyPlan.metadata.vaultIndex,
    vaultPubkey: routePolicyPlan.metadata.vault.toBase58(),
  };
  const depositValues = {
    cluster: input.cluster,
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

  const [, insertedDeposits] = await client.db.batch([
    client.db
      .insert(managedVaults)
      .values(managedVaultValues)
      .onConflictDoUpdate({
        target: [
          managedVaults.cluster,
          managedVaults.settings,
          managedVaults.vaultIndex,
          managedVaults.vaultPubkey,
        ],
        set: {
          active: true,
          activePolicyId: routePolicy.id,
          lastSeenAt: now,
        },
      }),
    client.db
      .insert(userYieldPositionDeposits)
      .values(depositValues)
      .onConflictDoNothing({
        target: [
          userYieldPositionDeposits.cluster,
          userYieldPositionDeposits.depositSignature,
        ],
      })
      .returning({ id: userYieldPositionDeposits.id }),
  ]);

  if (insertedDeposits.length > 0) {
    return upsertAggregatePosition({
      client,
      input,
      mode: "increment-principal",
      now,
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

export async function findActiveYieldPosition(
  input: ActiveYieldPositionLookupInput,
  dependencies: Pick<YieldDepositRepositoryDependencies, "client"> = {
    client: getYieldOptimizationClient(),
  }
): Promise<UserYieldPositionRecord | null> {
  const position =
    await dependencies.client.db.query.userYieldPositions.findFirst({
      where: and(
        eq(userYieldPositions.cluster, input.cluster),
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.targetReserve, input.targetReserve),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.walletAddress, input.walletAddress),
        eq(userYieldPositions.status, "active")
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
      eq(routePolicies.cluster, input.cluster),
      eq(routePolicies.settings, input.settings),
      eq(routePolicies.vaultIndex, input.vaultIndex),
      eq(routePolicies.active, true)
    ),
    orderBy: [asc(routePolicies.id)],
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
    eq(userYieldPositionDeposits.cluster, input.cluster),
    eq(userYieldPositionDeposits.settings, input.settings),
    eq(userYieldPositionDeposits.targetReserve, input.targetReserve),
    eq(userYieldPositionDeposits.vaultIndex, input.vaultIndex),
    eq(userYieldPositionDeposits.walletAddress, input.walletAddress),
  ];
  const withdrawalFilters = [
    eq(userYieldPositionWithdrawals.cluster, input.cluster),
    eq(userYieldPositionWithdrawals.settings, input.settings),
    eq(userYieldPositionWithdrawals.targetReserve, input.targetReserve),
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
      eq(userYieldPositions.cluster, input.cluster),
      eq(userYieldPositions.settings, input.settings),
      eq(userYieldPositions.vaultIndex, input.vaultIndex),
      eq(userYieldPositions.targetReserve, input.targetReserve)
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

  const withdrawalValues = {
    cluster: input.cluster,
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
      target: [
        userYieldPositionWithdrawals.cluster,
        userYieldPositionWithdrawals.withdrawalSignature,
      ],
    })
    .returning({ id: userYieldPositionWithdrawals.id });

  if (insertedWithdrawals.length === 0) {
    return existingPosition;
  }

  const positionUpdate = client.db
    .update(userYieldPositions)
    .set({
      lastConfirmedSlot: input.confirmedSlot,
      principalAmountRaw:
        input.mode === "full"
          ? BigInt(0)
          : sql`${userYieldPositions.principalAmountRaw} - ${input.withdrawnAmountRaw}`,
      status: input.mode === "full" ? "closed" : "active",
      updatedAt: now,
    })
    .where(
      and(
        eq(userYieldPositions.cluster, input.cluster),
        eq(userYieldPositions.settings, input.settings),
        eq(userYieldPositions.vaultIndex, input.vaultIndex),
        eq(userYieldPositions.targetReserve, input.targetReserve),
        eq(userYieldPositions.status, "active"),
        gte(userYieldPositions.principalAmountRaw, input.withdrawnAmountRaw)
      )
    )
    .returning();

  const queries = [positionUpdate];

  if (input.mode === "full") {
    queries.push(
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
	            eq(routePolicies.cluster, input.cluster),
	            eq(routePolicies.settings, input.settings),
	            eq(routePolicies.vaultIndex, input.vaultIndex)
	          )
	        ) as never,
      client.db
        .update(managedVaults)
        .set({ active: false, lastSeenAt: now })
        .where(
          and(
            eq(managedVaults.cluster, input.cluster),
            eq(managedVaults.settings, input.settings),
            eq(managedVaults.vaultIndex, input.vaultIndex)
          )
        ) as never
    );
  }

  const [updatedPositions] = (await client.db.batch(queries as never)) as [
    UserYieldPositionRecord[],
    ...unknown[]
  ];

  const [position] = updatedPositions;
  if (!position) {
    throw new Error("Failed to update confirmed yield position withdrawal.");
  }
  if (position.principalAmountRaw !== nextPrincipal) {
    return position;
  }

  return position;
}
