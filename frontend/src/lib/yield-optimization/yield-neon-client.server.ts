import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  bigint,
  bigserial,
  boolean,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { getRequiredEnv } from "@/lib/core/config/shared";

const loyalYieldSchema = pgSchema("loyal_yield");
const YIELD_OPTIMIZATION_DATABASE_URL_ENV_NAME = "NEON_DATABASE_URL";

export const decisionStatus = loyalYieldSchema.enum("decision_status", [
  "planned",
  "simulating",
  "ready",
  "submitted",
  "confirming",
  "confirmed",
  "failed",
  "abandoned",
  "skipped",
]);

export const decisionReason = loyalYieldSchema.enum("decision_reason", [
  "target_supply_apy_exceeds_source",
  "active_decision",
  "no_value_source",
  "cross_mint_only",
  "no_same_mint_edge",
]);

export type YieldSwapLane = Record<string, unknown>;
export type YieldSnapshotContext = Record<string, unknown>;
export type YieldPlanningMetadata = Record<string, unknown>;

export const routePolicies = loyalYieldSchema.table(
  "route_policies",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey(),
    cluster: text("cluster").notNull(),
    settings: text("settings").notNull(),
    authority: text("authority").notNull(),
    policySeed: bigint("policy_seed", { mode: "bigint" }).notNull(),
    policyAccount: text("policy_account").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    delegatedSigners: text("delegated_signers").array().notNull(),
    threshold: integer("threshold").notNull(),
    routeModes: text("route_modes").array().notNull(),
    stableMints: text("stable_mints").array().notNull(),
    kaminoMarkets: text("kamino_markets").array().notNull(),
    kaminoLiquidityMints: text("kamino_liquidity_mints").array().notNull(),
    universePreset: text("universe_preset"),
    riskProfile: text("risk_profile"),
    swapLanes: jsonb("swap_lanes").$type<YieldSwapLane[]>().notNull(),
    active: boolean("active").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastSeenSlot: bigint("last_seen_slot", { mode: "bigint" }).notNull(),
    lastSeenSignature: text("last_seen_signature").notNull(),
  },
  (table) => [
    uniqueIndex("route_policies_cluster_policy_account_uidx").on(
      table.cluster,
      table.policyAccount
    ),
  ]
);

export const managedVaults = loyalYieldSchema.table(
  "managed_vaults",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    cluster: text("cluster").notNull(),
    settings: text("settings").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    activePolicyId: bigint("active_policy_id", { mode: "bigint" }).notNull(),
    active: boolean("active").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("managed_vaults_cluster_settings_index_uidx").on(
      table.cluster,
      table.settings,
      table.vaultIndex
    ),
  ]
);

export const yieldPositionStatus = loyalYieldSchema.enum(
  "yield_position_status",
  ["active", "closed"]
);

export const userYieldPositions = loyalYieldSchema.table(
  "user_yield_positions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    cluster: text("cluster").notNull(),
    walletAddress: text("wallet_address").notNull(),
    smartAccountAddress: text("smart_account_address").notNull(),
    settings: text("settings").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    policyId: bigint("policy_id", { mode: "bigint" }).notNull(),
    policyAccount: text("policy_account").notNull(),
    policySeed: bigint("policy_seed", { mode: "bigint" }).notNull(),
    targetReserve: text("target_reserve").notNull(),
    market: text("market"),
    liquidityMint: text("liquidity_mint").notNull(),
    targetSupplyApyBps: bigint("target_supply_apy_bps", {
      mode: "bigint",
    }),
    depositMint: text("deposit_mint").notNull(),
    principalAmountRaw: bigint("principal_amount_raw", {
      mode: "bigint",
    }).notNull(),
    firstDepositSignature: text("first_deposit_signature").notNull(),
    lastDepositSignature: text("last_deposit_signature").notNull(),
    lastConfirmedSlot: bigint("last_confirmed_slot", {
      mode: "bigint",
    }).notNull(),
    status: yieldPositionStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("user_yield_positions_target_uidx").on(
      table.cluster,
      table.settings,
      table.vaultIndex,
      table.targetReserve
    ),
  ]
);

export const userYieldPositionDeposits = loyalYieldSchema.table(
  "user_yield_position_deposits",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    cluster: text("cluster").notNull(),
    depositSignature: text("deposit_signature").notNull(),
    policySignature: text("policy_signature").notNull(),
    confirmedSlot: bigint("confirmed_slot", { mode: "bigint" }).notNull(),
    walletAddress: text("wallet_address").notNull(),
    smartAccountAddress: text("smart_account_address").notNull(),
    settings: text("settings").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    policyId: bigint("policy_id", { mode: "bigint" }).notNull(),
    policyAccount: text("policy_account").notNull(),
    policySeed: bigint("policy_seed", { mode: "bigint" }).notNull(),
    targetReserve: text("target_reserve").notNull(),
    market: text("market"),
    liquidityMint: text("liquidity_mint").notNull(),
    targetSupplyApyBps: bigint("target_supply_apy_bps", {
      mode: "bigint",
    }),
    depositMint: text("deposit_mint").notNull(),
    principalAmountRaw: bigint("principal_amount_raw", {
      mode: "bigint",
    }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("user_yield_position_deposits_signature_uidx").on(
      table.cluster,
      table.depositSignature
    ),
  ]
);

export const vaultPositionSnapshots = loyalYieldSchema.table(
  "vault_position_snapshots",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey(),
    vaultId: bigint("vault_id", { mode: "bigint" }).notNull(),
    policyId: bigint("policy_id", { mode: "bigint" }).notNull(),
    observedSlot: bigint("observed_slot", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    chainSlot: bigint("chain_slot", { mode: "bigint" }),
    lockAttemptId: bigint("lock_attempt_id", { mode: "bigint" }),
    isCurrent: boolean("is_current").notNull(),
    context: jsonb("context").$type<YieldSnapshotContext>().notNull(),
  }
);

export const vaultPositionSnapshotPositions = loyalYieldSchema.table(
  "vault_position_snapshot_positions",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey(),
    snapshotId: bigint("snapshot_id", { mode: "bigint" }).notNull(),
    reserve: text("reserve").notNull(),
    market: text("market"),
    liquidityMint: text("liquidity_mint").notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    supplyApyBps: bigint("supply_apy_bps", { mode: "bigint" }),
    borrowApyBps: bigint("borrow_apy_bps", { mode: "bigint" }),
    hasValue: boolean("has_value").notNull(),
    planningMetadata: jsonb("planning_metadata")
      .$type<YieldPlanningMetadata>()
      .notNull(),
  }
);

export const vaultReservePositionsCurrent = loyalYieldSchema.table(
  "vault_reserve_positions_current",
  {
    vaultId: bigint("vault_id", { mode: "bigint" }).notNull(),
    reserve: text("reserve").notNull(),
    market: text("market"),
    liquidityMint: text("liquidity_mint").notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    hasValue: boolean("has_value").notNull(),
    supplyApyBps: bigint("supply_apy_bps", { mode: "bigint" }),
    borrowApyBps: bigint("borrow_apy_bps", { mode: "bigint" }),
    snapshotId: bigint("snapshot_id", { mode: "bigint" }).notNull(),
    observedSlot: bigint("observed_slot", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    planningMetadata: jsonb("planning_metadata")
      .$type<YieldPlanningMetadata>()
      .notNull(),
  }
);

export const rebalanceDecisions = loyalYieldSchema.table(
  "rebalance_decisions",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey(),
    vaultId: bigint("vault_id", { mode: "bigint" }).notNull(),
    sourceSnapshotId: bigint("source_snapshot_id", { mode: "bigint" }),
    status: decisionStatus("status").notNull(),
    sourceReserve: text("source_reserve"),
    targetReserve: text("target_reserve"),
    liquidityMint: text("liquidity_mint"),
    amountRaw: bigint("amount_raw", { mode: "bigint" }),
    sourceApyBps: bigint("source_apy_bps", { mode: "bigint" }),
    targetApyBps: bigint("target_apy_bps", { mode: "bigint" }),
    estimatedEdgeBps: bigint("estimated_edge_bps", { mode: "bigint" }),
    estimatedCostLamports: bigint("estimated_cost_lamports", {
      mode: "bigint",
    }).notNull(),
    decisionReason: decisionReason("decision_reason").notNull(),
    abandonReason: text("abandon_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    signature: text("signature"),
    submittedSlot: bigint("submitted_slot", { mode: "bigint" }),
    confirmedSlot: bigint("confirmed_slot", { mode: "bigint" }),
    preflightChainSlot: bigint("preflight_chain_slot", { mode: "bigint" }),
    postSnapshotId: bigint("post_snapshot_id", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  }
);

export const yieldOptimizationSchema = {
  managedVaults,
  rebalanceDecisions,
  routePolicies,
  userYieldPositionDeposits,
  userYieldPositions,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  vaultReservePositionsCurrent,
};

export type YieldOptimizationSchema = typeof yieldOptimizationSchema;
export type YieldOptimizationDatabase =
  NeonHttpDatabase<YieldOptimizationSchema>;

export type YieldOptimizationClientConfig = {
  databaseUrl: string;
};

export type YieldOptimizationClientTables = {
  managedVaults: typeof managedVaults;
  rebalanceDecisions: typeof rebalanceDecisions;
  routePolicies: typeof routePolicies;
  userYieldPositionDeposits: typeof userYieldPositionDeposits;
  userYieldPositions: typeof userYieldPositions;
  vaultPositionSnapshotPositions: typeof vaultPositionSnapshotPositions;
  vaultPositionSnapshots: typeof vaultPositionSnapshots;
  vaultReservePositionsCurrent: typeof vaultReservePositionsCurrent;
};

export class YieldOptimizationClient {
  readonly db: YieldOptimizationDatabase;
  readonly tables: YieldOptimizationClientTables = {
    managedVaults,
    rebalanceDecisions,
    routePolicies,
    userYieldPositionDeposits,
    userYieldPositions,
    vaultPositionSnapshotPositions,
    vaultPositionSnapshots,
    vaultReservePositionsCurrent,
  };

  constructor(config: YieldOptimizationClientConfig) {
    const sql = neon(config.databaseUrl);
    this.db = drizzle({ client: sql, schema: yieldOptimizationSchema });
  }
}

let yieldOptimizationClient: YieldOptimizationClient | null = null;

export function getYieldOptimizationClient(): YieldOptimizationClient {
  if (yieldOptimizationClient) {
    return yieldOptimizationClient;
  }

  yieldOptimizationClient = new YieldOptimizationClient({
    databaseUrl: getRequiredEnv(
      process.env,
      YIELD_OPTIMIZATION_DATABASE_URL_ENV_NAME
    ),
  });

  return yieldOptimizationClient;
}
