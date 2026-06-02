import "server-only";

import { and, eq, sql } from "drizzle-orm";

import {
  getYieldOptimizationClient,
  managedVaults,
  routePolicies,
  userYieldPositionDeposits,
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

type YieldDepositRepositoryDependencies = {
  client: YieldOptimizationClient;
  now: () => Date;
};

function createDependencies(): YieldDepositRepositoryDependencies {
  return {
    client: getYieldOptimizationClient(),
    now: () => new Date(),
  };
}

function createRoutePolicySwapLane(input: ConfirmedYieldDepositInput) {
  return {
    depositMint: input.depositMint,
    liquidityMint: input.liquidityMint,
    market: input.market,
    targetReserve: input.targetReserve,
    targetSupplyApyBps: input.targetSupplyApyBps?.toString() ?? null,
  };
}

export async function recordConfirmedYieldDeposit(
  input: ConfirmedYieldDepositInput,
  dependencies: YieldDepositRepositoryDependencies = createDependencies()
): Promise<UserYieldPositionRecord> {
  const { client } = dependencies;
  const now = dependencies.now();
  const routePolicyValues = {
    active: true,
    authority: input.smartAccountAddress,
    cluster: input.cluster,
    delegatedSigners: [input.walletAddress],
    firstSeenAt: now,
    id: input.policyId,
    kaminoLiquidityMints: [input.liquidityMint],
    kaminoMarkets: input.market ? [input.market] : [],
    lastSeenAt: now,
    lastSeenSignature: input.policySignature,
    lastSeenSlot: input.confirmedSlot,
    policyAccount: input.policyAccount,
    policySeed: input.policySeed,
    riskProfile: "safe_no_fees",
    routeModes: ["kamino_supply"],
    settings: input.settings,
    stableMints: [input.depositMint],
    swapLanes: [createRoutePolicySwapLane(input)],
    threshold: 1,
    universePreset: "safe_no_fees",
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
  };
  const managedVaultValues = {
    active: true,
    activePolicyId: input.policyId,
    cluster: input.cluster,
    firstSeenAt: now,
    lastSeenAt: now,
    settings: input.settings,
    vaultIndex: input.vaultIndex,
    vaultPubkey: input.vaultPubkey,
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

  const [, , insertedDeposits] = await client.db.batch([
    client.db
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
          vaultIndex: input.vaultIndex,
          vaultPubkey: input.vaultPubkey,
        },
      }),
    client.db
      .insert(managedVaults)
      .values(managedVaultValues)
      .onConflictDoUpdate({
        target: [
          managedVaults.cluster,
          managedVaults.settings,
          managedVaults.vaultIndex,
        ],
        set: {
          active: true,
          activePolicyId: input.policyId,
          lastSeenAt: now,
          vaultPubkey: input.vaultPubkey,
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
          lastConfirmedSlot: input.confirmedSlot,
          lastDepositSignature: input.depositSignature,
          liquidityMint: input.liquidityMint,
          market: input.market,
          policyAccount: input.policyAccount,
          policyId: input.policyId,
          policySeed: input.policySeed,
          principalAmountRaw: sql`${userYieldPositions.principalAmountRaw} + ${input.principalAmountRaw}`,
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

  const existingPosition = await client.db.query.userYieldPositions.findFirst({
    where: and(
      eq(userYieldPositions.cluster, input.cluster),
      eq(userYieldPositions.settings, input.settings),
      eq(userYieldPositions.vaultIndex, input.vaultIndex),
      eq(userYieldPositions.targetReserve, input.targetReserve)
    ),
  });

  if (!existingPosition) {
    throw new Error("Confirmed yield deposit exists without a yield position.");
  }

  return existingPosition;
}
