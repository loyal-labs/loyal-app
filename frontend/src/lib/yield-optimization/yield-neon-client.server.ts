import "server-only";

import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { getRequiredEnv } from "@/lib/core/config/shared";
import type {
  EarnForecastApyHistorySample,
  EarnForecastApyHistorySeries,
} from "@/lib/kamino/earn-forecast.shared";

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
  "unsupported_amount_semantics",
  "idle_vault_liquidity_available",
]);

export const balanceSweepSurplusClassification = loyalYieldSchema.enum(
  "balance_sweep_surplus_classification",
  [
    "earn_withdrawal",
    "simple_inbound",
    "complex_defi",
    "unknown",
    "explicit_redeposit",
    "initial_surplus",
    "floor_rebaseline",
  ]
);

export const balanceSweepSurplusLotStatus = loyalYieldSchema.enum(
  "balance_sweep_surplus_lot_status",
  ["open", "selected", "consumed", "depleted", "suppressed"]
);

export const balanceSweepLotClaimStatus = loyalYieldSchema.enum(
  "balance_sweep_lot_claim_status",
  ["selected", "executed", "released", "failed"]
);

export const balanceSweepScheduledSlotStatus = loyalYieldSchema.enum(
  "balance_sweep_scheduled_slot_status",
  [
    "scheduled",
    "requested",
    "selected",
    "executed",
    "failed",
    "released",
    "canceled",
  ]
);

type YieldSwapLaneInstructionIndexes =
  | number[]
  | readonly [number, number, number];

type YieldSwapLaneBase = Record<string, unknown> & {
  actionAccount?: string;
  action_account?: string;
  instructionConstraintIndexes?: YieldSwapLaneInstructionIndexes;
  instruction_constraint_indexes?: YieldSwapLaneInstructionIndexes;
};

export type YieldSwapLane =
  | (YieldSwapLaneBase & {
      exactInDiscriminator?: number[];
      exact_in_discriminator?: number[];
      kind?: "jupiter";
      lane?: "jupiter";
      programId?: string;
      program_id?: string;
    })
  | (YieldSwapLaneBase & {
      hubAuthorizer?: string;
      hub_authorizer?: string;
      kind?: "loyal_hub";
      lane?: "loyal_hub";
      maxFeeBps?: number;
      max_fee_bps?: number;
    })
  | (Record<string, unknown> & {
      kind?: string;
      lane?: string;
    });
export type YieldSnapshotContext = Record<string, unknown>;
export type YieldPlanningMetadata = Record<string, unknown>;
export type EarnForecastSnapshotSample = EarnForecastApyHistorySample;
export type YieldWithdrawalReserveMetadata = {
  accountingReserve: string;
  collateralAta: string;
  executionMarket: string;
  executionReserve: string;
  kaminoWithdrawAmountRaw: string;
  liquidityMint: string;
  market: string | null;
  reserve: string;
  withdrawnAmountRaw: string;
};

export const earnDepositOnboardingAttempts = loyalYieldSchema.table(
  "earn_deposit_onboarding_attempts",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    delegatedSigner: text("delegated_signer").notNull(),
    smartAccountAddress: text("smart_account_address"),
    settings: text("settings").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    policyId: bigint("policy_id", { mode: "bigint" }).notNull(),
    policyAccount: text("policy_account").notNull(),
    policySeed: bigint("policy_seed", { mode: "bigint" }).notNull(),
    routePolicyDbId: bigint("route_policy_db_id", { mode: "bigint" }),
    routePolicySignature: text("route_policy_signature"),
    routePolicyConfirmedSlot: bigint("route_policy_confirmed_slot", {
      mode: "bigint",
    }),
    setupPolicyId: bigint("setup_policy_id", { mode: "bigint" }),
    setupPolicyAccount: text("setup_policy_account"),
    setupPolicySeed: bigint("setup_policy_seed", { mode: "bigint" }),
    setupPolicyDbId: bigint("setup_policy_db_id", { mode: "bigint" }),
    setupPolicySignature: text("setup_policy_signature"),
    setupPolicyConfirmedSlot: bigint("setup_policy_confirmed_slot", {
      mode: "bigint",
    }),
    depositSignature: text("deposit_signature"),
    depositConfirmedSlot: bigint("deposit_confirmed_slot", {
      mode: "bigint",
    }),
    depositMint: text("deposit_mint"),
    principalAmountRaw: bigint("principal_amount_raw", { mode: "bigint" }),
    targetReserve: text("target_reserve").notNull(),
    market: text("market"),
    liquidityMint: text("liquidity_mint").notNull(),
    targetSupplyApyBps: bigint("target_supply_apy_bps", { mode: "bigint" }),
    status: text("status").notNull(),
    lastErrorCode: text("last_error_code"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("earn_deposit_onboarding_active_attempt_uidx")
      .on(table.settings, table.vaultIndex, table.vaultPubkey)
      .where(sql`${table.status} <> 'complete'`),
    index("earn_deposit_onboarding_wallet_idx").on(
      table.walletAddress,
      table.updatedAt
    ),
    index("earn_deposit_onboarding_deposit_signature_idx")
      .on(table.depositSignature)
      .where(sql`${table.depositSignature} IS NOT NULL`),
  ]
);

export const routePolicies = loyalYieldSchema.table(
  "route_policies",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
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
    uniqueIndex("route_policies_policy_account_uidx").on(table.policyAccount),
  ]
);

export const managedVaults = loyalYieldSchema.table(
  "managed_vaults",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    settings: text("settings").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    activePolicyId: bigint("active_policy_id", { mode: "bigint" }).notNull(),
    setupPolicyId: bigint("setup_policy_id", { mode: "bigint" }),
    active: boolean("active").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    lastReconciledSlot: bigint("last_reconciled_slot", { mode: "bigint" }),
  },
  (table) => [
    uniqueIndex("managed_vaults_settings_index_uidx").on(
      table.settings,
      table.vaultIndex,
      table.vaultPubkey
    ),
    index("managed_vaults_setup_policy_idx")
      .on(table.setupPolicyId)
      .where(sql`${table.setupPolicyId} IS NOT NULL`),
  ]
);

export const yieldPositionStatus = loyalYieldSchema.enum(
  "yield_position_status",
  ["active", "closed"]
);

export const userYieldHoldingEventType = loyalYieldSchema.enum(
  "user_yield_holding_event_type",
  [
    "deposit_initialized",
    "deposit_top_up",
    "withdrawal_partial",
    "withdrawal_full",
    "rebalance_confirmed",
    "snapshot_reconciled",
  ]
);

export const userYieldPositions = loyalYieldSchema.table(
  "user_yield_positions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    smartAccountAddress: text("smart_account_address").notNull(),
    settings: text("settings").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    policyId: bigint("policy_id", { mode: "bigint" }).notNull(),
    policyAccount: text("policy_account").notNull(),
    policySeed: bigint("policy_seed", { mode: "bigint" }).notNull(),
    initialReserve: text("initial_reserve").notNull(),
    initialMarket: text("initial_market"),
    initialLiquidityMint: text("initial_liquidity_mint").notNull(),
    initialSupplyApyBps: bigint("initial_supply_apy_bps", {
      mode: "bigint",
    }),
    depositMint: text("deposit_mint").notNull(),
    principalAmountRaw: bigint("principal_amount_raw", {
      mode: "bigint",
    }).notNull(),
    currentReserve: text("current_reserve").notNull(),
    currentMarket: text("current_market"),
    currentLiquidityMint: text("current_liquidity_mint").notNull(),
    currentAmountRaw: bigint("current_amount_raw", {
      mode: "bigint",
    }).notNull(),
    currentObservedSlot: bigint("current_observed_slot", {
      mode: "bigint",
    }).notNull(),
    currentObservedAt: timestamp("current_observed_at", {
      withTimezone: true,
    }).notNull(),
    lastHoldingEventId: bigint("last_holding_event_id", { mode: "bigint" }),
    lastRebalanceDecisionId: bigint("last_rebalance_decision_id", {
      mode: "bigint",
    }),
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
      table.settings,
      table.vaultIndex,
      table.initialReserve
    ),
    check(
      "user_yield_positions_smart_account_is_vault",
      sql`${table.smartAccountAddress} = ${table.vaultPubkey}`
    ),
  ]
);

export const userYieldPositionHoldingEvents = loyalYieldSchema.table(
  "user_yield_position_holding_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    positionId: bigint("position_id", { mode: "bigint" }).notNull(),
    eventType: userYieldHoldingEventType("event_type").notNull(),
    reserve: text("reserve").notNull(),
    market: text("market"),
    liquidityMint: text("liquidity_mint").notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    principalDeltaRaw: bigint("principal_delta_raw", { mode: "bigint" }),
    holdingDeltaRaw: bigint("holding_delta_raw", { mode: "bigint" }),
    observedSlot: bigint("observed_slot", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sourceSignature: text("source_signature"),
    sourceDepositId: bigint("source_deposit_id", { mode: "bigint" }),
    sourceWithdrawalId: bigint("source_withdrawal_id", { mode: "bigint" }),
    sourceRebalanceDecisionId: bigint("source_rebalance_decision_id", {
      mode: "bigint",
    }),
    sourceSnapshotId: bigint("source_snapshot_id", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("user_yield_position_holding_events_rebalance_decision_uidx")
      .on(table.sourceRebalanceDecisionId)
      .where(sql`${table.sourceRebalanceDecisionId} IS NOT NULL`),
  ]
);

export const userYieldPositionDeposits = loyalYieldSchema.table(
  "user_yield_position_deposits",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
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
      table.depositSignature
    ),
    check(
      "user_yield_position_deposits_smart_account_is_vault",
      sql`${table.smartAccountAddress} = ${table.vaultPubkey}`
    ),
  ]
);

export const userYieldPositionWithdrawals = loyalYieldSchema.table(
  "user_yield_position_withdrawals",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    withdrawalSignature: text("withdrawal_signature").notNull(),
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
    withdrawnAmountRaw: bigint("withdrawn_amount_raw", {
      mode: "bigint",
    }).notNull(),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    reserveWithdrawals: jsonb("reserve_withdrawals")
      .$type<YieldWithdrawalReserveMetadata[]>()
      .notNull()
      .default([]),
    mode: text("mode").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("user_yield_position_withdrawals_signature_uidx").on(
      table.withdrawalSignature
    ),
    check(
      "user_yield_position_withdrawals_smart_account_is_vault",
      sql`${table.smartAccountAddress} = ${table.vaultPubkey}`
    ),
  ]
);

export const vaultPositionSnapshots = loyalYieldSchema.table(
  "vault_position_snapshots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
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
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
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

export const vaultIdleTokenBalancesCurrent = loyalYieldSchema.table(
  "vault_idle_token_balances_current",
  {
    vaultId: bigint("vault_id", { mode: "bigint" }).notNull(),
    mint: text("mint").notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    owner: text("owner").notNull(),
    tokenAccount: text("token_account").notNull(),
    observedSlot: bigint("observed_slot", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sourceCommitment: text("source_commitment").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.vaultId, table.mint],
      name: "vault_idle_token_balances_current_pkey",
    }),
    index("vault_idle_token_balances_current_mint_idx").on(table.mint),
  ]
);

export const earnForecastSnapshots = loyalYieldSchema.table(
  "earn_forecast_snapshots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    strategy: text("strategy").notNull(),
    riskProfile: text("risk_profile").notNull(),
    feeBps: smallint("fee_bps").notNull(),
    snapshotDate: date("snapshot_date", { mode: "date" }).notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    windowEndedAt: timestamp("window_ended_at", {
      withTimezone: true,
    }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    apyBps: integer("apy_bps").notNull(),
    rangeLowBps: integer("range_low_bps").notNull(),
    rangeHighBps: integer("range_high_bps").notNull(),
    samples: jsonb("samples").$type<EarnForecastSnapshotSample[]>().notNull(),
    series: jsonb("series").$type<EarnForecastApyHistorySeries[]>().notNull(),
  },
  (table) => [
    uniqueIndex("earn_forecast_snapshots_latest_key_uidx").on(
      table.strategy,
      table.riskProfile,
      table.feeBps,
      table.snapshotDate
    ),
  ]
);

export const earnApyHourlySnapshots = loyalYieldSchema.table(
  "earn_apy_hourly_snapshots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    strategy: text("strategy").notNull(),
    riskProfile: text("risk_profile").notNull(),
    feeBps: smallint("fee_bps").notNull(),
    sampleHour: timestamp("sample_hour", { withTimezone: true }).notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    windowEndedAt: timestamp("window_ended_at", {
      withTimezone: true,
    }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    loyalApyBps: integer("loyal_apy_bps").notNull(),
    mainUsdcReserveApyBps: integer("main_usdc_reserve_apy_bps").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex("earn_apy_hourly_snapshots_key_uidx").on(
      table.strategy,
      table.riskProfile,
      table.feeBps,
      table.sampleHour
    ),
  ]
);

export const balanceSweepPolicies = loyalYieldSchema.table(
  "balance_sweep_policies",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    settings: text("settings").notNull(),
    authority: text("authority").notNull(),
    policySeed: bigint("policy_seed", { mode: "bigint" }).notNull(),
    policyAccount: text("policy_account").notNull(),
    policyType: text("policy_type").default("subscription_sweep").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    delegatedSigners: text("delegated_signers").array().notNull(),
    threshold: integer("threshold").notNull(),
    liquidityMint: text("liquidity_mint"),
    subscriptionAuthority: text("subscription_authority"),
    subscriptionDelegatee: text("subscription_delegatee"),
    walletUsdcAta: text("wallet_usdc_ata"),
    vaultUsdcAta: text("vault_usdc_ata"),
    maxAmountPerPeriod: bigint("max_amount_per_period", {
      mode: "bigint",
    }),
    active: boolean("active").default(true).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastSeenSlot: bigint("last_seen_slot", { mode: "bigint" }).notNull(),
    lastSeenSignature: text("last_seen_signature").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeSignature: text("close_signature"),
    closeSlot: bigint("close_slot", { mode: "bigint" }),
  },
  (table) => [
    uniqueIndex("balance_sweep_policies_policy_account_uidx").on(
      table.policyAccount
    ),
    index("balance_sweep_policies_active_authority_idx").on(
      table.active,
      table.authority
    ),
  ]
);

export const balanceSweepTargets = loyalYieldSchema.table(
  "balance_sweep_targets",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    balanceSweepPolicyId: bigint("balance_sweep_policy_id", {
      mode: "bigint",
    }),
    settings: text("settings").notNull(),
    authority: text("authority").notNull(),
    policySeed: bigint("policy_seed", { mode: "bigint" }).notNull(),
    policyAccount: text("policy_account").notNull(),
    vaultIndex: smallint("vault_index").notNull(),
    vaultPubkey: text("vault_pubkey").notNull(),
    wallet: text("wallet").notNull(),
    walletUsdcAta: text("wallet_usdc_ata").notNull(),
    vaultUsdcAta: text("vault_usdc_ata").notNull(),
    tokenMint: text("token_mint").notNull(),
    walletTokenAta: text("wallet_token_ata").notNull(),
    vaultTokenAta: text("vault_token_ata").notNull(),
    delegatedSigners: text("delegated_signers").array().notNull(),
    threshold: integer("threshold").notNull(),
    cluster: text("cluster"),
    maxAmountPerPeriod: bigint("max_amount_per_period", {
      mode: "bigint",
    }).notNull(),
    active: boolean("active").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastSeenSlot: bigint("last_seen_slot", { mode: "bigint" }).notNull(),
    lastSeenSignature: text("last_seen_signature").notNull(),
    subscriptionAuthority: text("subscription_authority"),
    recurringDelegation: text("recurring_delegation"),
    recurringDelegationNonce: bigint("recurring_delegation_nonce", {
      mode: "bigint",
    }),
    recurringDelegationExpiryTimestamp: bigint(
      "recurring_delegation_expiry_timestamp",
      { mode: "bigint" }
    ),
    periodLengthSeconds: bigint("period_length_seconds", { mode: "bigint" }),
    startTimestamp: bigint("start_timestamp", { mode: "bigint" }),
    walletBalanceFloorRaw: bigint("wallet_balance_floor_raw", {
      mode: "bigint",
    }),
    policySignature: text("policy_signature"),
    policyConfirmedSlot: bigint("policy_confirmed_slot", { mode: "bigint" }),
    recurringDelegationSignature: text("recurring_delegation_signature"),
    recurringDelegationConfirmedSlot: bigint(
      "recurring_delegation_confirmed_slot",
      { mode: "bigint" }
    ),
    lifecycleStatus: text("lifecycle_status").default("active").notNull(),
    closeSignature: text("close_signature"),
    closeSlot: bigint("close_slot", { mode: "bigint" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("balance_sweep_targets_policy_account_uidx").on(
      table.policyAccount
    ),
    uniqueIndex("balance_sweep_targets_recurring_delegation_uidx")
      .on(table.recurringDelegation)
      .where(sql`${table.recurringDelegation} IS NOT NULL`),
    index("balance_sweep_targets_active_wallet_ata_idx").on(
      table.walletUsdcAta
    ),
    index("balance_sweep_targets_active_wallet_token_ata_idx").on(
      table.active,
      table.tokenMint,
      table.walletTokenAta
    ),
    index("balance_sweep_targets_wallet_idx").on(table.wallet),
    index("balance_sweep_targets_wallet_token_idx").on(
      table.wallet,
      table.tokenMint,
      table.active
    ),
  ]
);

export const balanceSweepWalletBalanceEvents = loyalYieldSchema.table(
  "balance_sweep_wallet_balance_events",
  {
    eventId: bigint("event_id", { mode: "bigint" }).primaryKey(),
    targetId: bigint("target_id", { mode: "bigint" }).notNull(),
    wallet: text("wallet").notNull(),
    walletUsdcAta: text("wallet_usdc_ata").notNull(),
    walletTokenAta: text("wallet_token_ata").notNull(),
    mint: text("mint").notNull(),
    previousAmountRaw: bigint("previous_amount_raw", { mode: "bigint" }),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    deltaAmountRaw: bigint("delta_amount_raw", { mode: "bigint" }),
    observedSlot: bigint("observed_slot", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    sourceCommitment: text("source_commitment").notNull(),
    txnSignature: text("txn_signature"),
    accountDataHash: text("account_data_hash"),
    rawEvidence: jsonb("raw_evidence")
      .$type<Record<string, unknown>>()
      .notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("balance_sweep_wallet_balance_events_target_event_idx").on(
      table.targetId,
      table.eventId
    ),
    index("balance_sweep_wallet_balance_events_target_slot_idx").on(
      table.targetId,
      table.observedSlot
    ),
    index("balance_sweep_wallet_balance_events_target_mint_event_idx").on(
      table.targetId,
      table.mint,
      table.eventId
    ),
    index("balance_sweep_wallet_balance_events_txn_signature_idx")
      .on(table.txnSignature)
      .where(sql`${table.txnSignature} IS NOT NULL`),
  ]
);

export const balanceSweepSurplusLots = loyalYieldSchema.table(
  "balance_sweep_surplus_lots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    targetId: bigint("target_id", { mode: "bigint" }).notNull(),
    scheduledSlotId: bigint("scheduled_slot_id", { mode: "bigint" }),
    sourceEventId: bigint("source_event_id", { mode: "bigint" }).notNull(),
    sourceSignature: text("source_signature"),
    originalAmountRaw: bigint("original_amount_raw", {
      mode: "bigint",
    }).notNull(),
    remainingAmountRaw: bigint("remaining_amount_raw", {
      mode: "bigint",
    }).notNull(),
    classification:
      balanceSweepSurplusClassification("classification").notNull(),
    eligibleAfter: timestamp("eligible_after", {
      withTimezone: true,
    }).notNull(),
    status: balanceSweepSurplusLotStatus("status").default("open").notNull(),
    confidence: text("confidence").default("unknown").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("balance_sweep_surplus_lots_source_event_id_key").on(
      table.sourceEventId
    ),
    index("balance_sweep_surplus_lots_target_status_eligible_idx").on(
      table.targetId,
      table.status,
      table.eligibleAfter,
      table.id
    ),
    index("balance_sweep_surplus_lots_source_signature_idx")
      .on(table.sourceSignature)
      .where(sql`${table.sourceSignature} IS NOT NULL`),
    index("balance_sweep_surplus_lots_scheduled_slot_idx")
      .on(table.scheduledSlotId, table.status, table.eligibleAfter, table.id)
      .where(sql`${table.scheduledSlotId} IS NOT NULL`),
  ]
);

export const balanceSweepScheduledSlots = loyalYieldSchema.table(
  "balance_sweep_scheduled_slots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    targetId: bigint("target_id", { mode: "bigint" }).notNull(),
    tokenMint: text("token_mint").notNull(),
    eligibleAfter: timestamp("eligible_after", {
      withTimezone: true,
    }).notNull(),
    status: balanceSweepScheduledSlotStatus("status")
      .default("scheduled")
      .notNull(),
    requestSource: text("request_source"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    claimToken: text("claim_token"),
    executionId: bigint("execution_id", { mode: "bigint" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("balance_sweep_scheduled_slots_target_status_idx").on(
      table.targetId,
      table.tokenMint,
      table.status,
      table.eligibleAfter,
      table.id
    ),
    index("balance_sweep_scheduled_slots_claim_token_idx")
      .on(table.claimToken)
      .where(sql`${table.claimToken} IS NOT NULL`),
  ]
);

export const balanceSweepLotClaims = loyalYieldSchema.table(
  "balance_sweep_lot_claims",
  {
    claimToken: text("claim_token").primaryKey(),
    targetId: bigint("target_id", { mode: "bigint" }).notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    status: balanceSweepLotClaimStatus("status").default("selected").notNull(),
    executionId: bigint("execution_id", { mode: "bigint" }),
    staleCheckEventId: bigint("stale_check_event_id", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("balance_sweep_lot_claims_target_status_idx").on(
      table.targetId,
      table.status,
      table.createdAt
    ),
  ]
);

export const balanceSweepLotClaimItems = loyalYieldSchema.table(
  "balance_sweep_lot_claim_items",
  {
    claimToken: text("claim_token").notNull(),
    lotId: bigint("lot_id", { mode: "bigint" }).notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.claimToken, table.lotId],
      name: "balance_sweep_lot_claim_items_pkey",
    }),
    index("balance_sweep_lot_claim_items_lot_idx").on(
      table.lotId,
      table.createdAt
    ),
  ]
);

export const balanceSweepExecutionLots = loyalYieldSchema.table(
  "balance_sweep_execution_lots",
  {
    executionId: bigint("execution_id", { mode: "bigint" }).notNull(),
    lotId: bigint("lot_id", { mode: "bigint" }).notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.executionId, table.lotId],
      name: "balance_sweep_execution_lots_pkey",
    }),
    index("balance_sweep_execution_lots_lot_idx").on(
      table.lotId,
      table.createdAt
    ),
  ]
);

export const balanceSweepWalletBalancesCurrent = loyalYieldSchema.table(
  "balance_sweep_wallet_balances_current",
  {
    targetId: bigint("target_id", { mode: "bigint" }).notNull(),
    wallet: text("wallet").notNull(),
    walletUsdcAta: text("wallet_usdc_ata").notNull(),
    walletTokenAta: text("wallet_token_ata").notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    owner: text("owner").notNull(),
    mint: text("mint").notNull(),
    observedSlot: bigint("observed_slot", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    sourceCommitment: text("source_commitment").notNull(),
    accountDataHash: text("account_data_hash").notNull(),
    rawEvidence: jsonb("raw_evidence").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.targetId, table.mint],
      name: "balance_sweep_wallet_balances_current_pkey",
    }),
    index("balance_sweep_wallet_balances_wallet_idx").on(
      table.wallet,
      table.walletUsdcAta
    ),
    index("balance_sweep_wallet_balances_wallet_token_idx").on(
      table.wallet,
      table.mint,
      table.updatedAt
    ),
  ]
);

export const balanceSweepExecutions = loyalYieldSchema.table(
  "balance_sweep_executions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    targetId: bigint("target_id", { mode: "bigint" }).notNull(),
    signature: text("signature").notNull(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    sourceWalletAta: text("source_wallet_ata").notNull(),
    destinationVaultAta: text("destination_vault_ata").notNull(),
    tokenMint: text("token_mint").notNull(),
    sourceTokenAta: text("source_token_ata").notNull(),
    destinationTokenAta: text("destination_token_ata").notNull(),
    amountRaw: bigint("amount_raw", { mode: "bigint" }).notNull(),
    sourcePreBalanceRaw: bigint("source_pre_balance_raw", { mode: "bigint" }),
    sourcePostBalanceRaw: bigint("source_post_balance_raw", {
      mode: "bigint",
    }),
    destinationPreBalanceRaw: bigint("destination_pre_balance_raw", {
      mode: "bigint",
    }),
    destinationPostBalanceRaw: bigint("destination_post_balance_raw", {
      mode: "bigint",
    }),
    sourceCommitment: text("source_commitment").notNull(),
    rawEvidence: jsonb("raw_evidence").$type<Record<string, unknown>>(),
    decodedEvidence: jsonb("decoded_evidence").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    decodedAt: timestamp("decoded_at", { withTimezone: true }),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (table) => [
    uniqueIndex("balance_sweep_executions_dedupe_key_key").on(table.dedupeKey),
    index("balance_sweep_executions_target_slot_idx").on(
      table.targetId,
      table.slot
    ),
    index("balance_sweep_executions_target_mint_slot_idx").on(
      table.targetId,
      table.tokenMint,
      table.slot,
      table.id
    ),
  ]
);

export const rebalanceDecisions = loyalYieldSchema.table(
  "rebalance_decisions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
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

export const routeLookupTables = loyalYieldSchema.table(
  "route_lookup_tables",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    cluster: text("cluster").notNull(),
    scope: text("scope").notNull(),
    tableAddress: text("table_address").notNull(),
    authority: text("authority").notNull(),
    payer: text("payer").notNull(),
    status: text("status").notNull().default("usable"),
    durable: boolean("durable").notNull().default(true),
    addressCount: integer("address_count").notNull().default(0),
    addressHash: text("address_hash").notNull().default(""),
    addresses: jsonb("addresses").$type<string[]>().notNull().default([]),
    createSignature: text("create_signature"),
    extendSignatures: jsonb("extend_signatures")
      .$type<string[]>()
      .notNull()
      .default([]),
    lastExtendedSlot: bigint("last_extended_slot", { mode: "bigint" }),
    warmupSlot: bigint("warmup_slot", { mode: "bigint" }),
    deactivatedSlot: bigint("deactivated_slot", { mode: "bigint" }),
    deactivateSignature: text("deactivate_signature"),
    closedSignature: text("closed_signature"),
    closeRecipient: text("close_recipient"),
    reclaimedLamports: bigint("reclaimed_lamports", { mode: "bigint" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("route_lookup_tables_table_address_key").on(
      table.tableAddress
    ),
    index("route_lookup_tables_active_scope_idx")
      .on(table.cluster, table.scope, table.authority, table.status)
      .where(
        sql`${table.durable} = TRUE AND ${table.status} IN ('active', 'warming', 'usable')`
      ),
    uniqueIndex("route_lookup_tables_unique_active_scope_idx")
      .on(table.cluster, table.scope, table.authority)
      .where(
        sql`${table.durable} = TRUE AND ${table.status} IN ('active', 'warming', 'usable')`
      ),
    index("route_lookup_tables_cleanup_idx").on(
      table.authority,
      table.durable,
      table.status,
      table.updatedAt
    ),
  ]
);

// Solana Week (dApp Store quests) attribution: our local mirror of the quest
// completions we report to Solana. Idempotent per (wallet, quest_kind); also the
// data source for in-app quest progress without hitting Solana's read API.
export const solanaWeekQuestCompletions = loyalYieldSchema.table(
  "solana_week_quest_completions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    // Internal quest identifier: 'earn_deposit' | 'first_autodeposit_sweep'.
    questKind: text("quest_kind").notNull(),
    // The Solana quest_id we reported (recorded once known/configured).
    questId: text("quest_id"),
    // Our reporting state: 'pending' | 'reported' | 'failed'.
    status: text("status").notNull(),
    // Solana's success kind, when reported: 'completed' | 'already_completed'.
    solanaStatus: text("solana_status"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("solana_week_quest_completion_wallet_kind_uidx").on(
      table.walletAddress,
      table.questKind
    ),
    // Lets the reconciler cheaply find rows still needing a (re)report.
    index("solana_week_quest_completion_unreported_idx")
      .on(table.updatedAt)
      .where(sql`${table.status} <> 'reported'`),
  ]
);

// Push-campaign sent log (ASK-1651 P2/P3): one row per (wallet, campaign).
// Mixpanel cohort webhooks re-send members after mid-sync failures, so the
// receiver inserts here first and only pushes when the insert lands.
export const pushCampaignSends = loyalYieldSchema.table(
  "push_campaign_sends",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    campaign: text("campaign").notNull(),
    cohortId: text("cohort_id"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("push_campaign_send_wallet_campaign_uidx").on(
      table.walletAddress,
      table.campaign
    ),
  ]
);

export const realtimeEvents = loyalYieldSchema.table(
  "realtime_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    eventType: text("event_type").notNull(),
    scope: text("scope").notNull(),
    reason: text("reason").notNull(),
    solanaEnv: text("solana_env"),
    walletAddress: text("wallet_address"),
    settingsPda: text("settings_pda"),
    smartAccountAddress: text("smart_account_address"),
    vaultPubkey: text("vault_pubkey"),
    targetId: bigint("target_id", { mode: "bigint" }),
    scheduledSlotId: bigint("scheduled_slot_id", { mode: "bigint" }),
    executionId: bigint("execution_id", { mode: "bigint" }),
    sourceTable: text("source_table"),
    sourceId: text("source_id"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    index("realtime_events_scope_id_idx").on(table.scope, table.id),
    index("realtime_events_settings_pda_id_idx")
      .on(table.settingsPda, table.id)
      .where(sql`${table.settingsPda} IS NOT NULL`),
    index("realtime_events_wallet_address_id_idx")
      .on(table.walletAddress, table.id)
      .where(sql`${table.walletAddress} IS NOT NULL`),
    index("realtime_events_target_id_id_idx")
      .on(table.targetId, table.id)
      .where(sql`${table.targetId} IS NOT NULL`),
    index("realtime_events_source_idx")
      .on(table.sourceTable, table.sourceId)
      .where(
        sql`${table.sourceTable} IS NOT NULL AND ${table.sourceId} IS NOT NULL`
      ),
    index("realtime_events_created_at_idx").on(table.createdAt),
  ]
);

export const yieldOptimizationSchema = {
  balanceSweepExecutions,
  balanceSweepExecutionLots,
  balanceSweepLotClaimItems,
  balanceSweepLotClaims,
  balanceSweepPolicies,
  balanceSweepSurplusLots,
  balanceSweepTargets,
  balanceSweepWalletBalanceEvents,
  balanceSweepWalletBalancesCurrent,
  earnDepositOnboardingAttempts,
  earnApyHourlySnapshots,
  earnForecastSnapshots,
  managedVaults,
  pushCampaignSends,
  realtimeEvents,
  rebalanceDecisions,
  routeLookupTables,
  routePolicies,
  solanaWeekQuestCompletions,
  userYieldPositionDeposits,
  userYieldPositionHoldingEvents,
  userYieldPositionWithdrawals,
  userYieldPositions,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  vaultIdleTokenBalancesCurrent,
  vaultReservePositionsCurrent,
};

export type YieldOptimizationSchema = typeof yieldOptimizationSchema;
export type YieldOptimizationDatabase =
  NeonHttpDatabase<YieldOptimizationSchema>;

export type YieldOptimizationClientConfig = {
  databaseUrl: string;
};

export type YieldOptimizationClientTables = {
  balanceSweepExecutions: typeof balanceSweepExecutions;
  balanceSweepExecutionLots: typeof balanceSweepExecutionLots;
  balanceSweepLotClaimItems: typeof balanceSweepLotClaimItems;
  balanceSweepLotClaims: typeof balanceSweepLotClaims;
  balanceSweepPolicies: typeof balanceSweepPolicies;
  balanceSweepSurplusLots: typeof balanceSweepSurplusLots;
  balanceSweepTargets: typeof balanceSweepTargets;
  balanceSweepWalletBalanceEvents: typeof balanceSweepWalletBalanceEvents;
  balanceSweepWalletBalancesCurrent: typeof balanceSweepWalletBalancesCurrent;
  earnDepositOnboardingAttempts: typeof earnDepositOnboardingAttempts;
  earnApyHourlySnapshots: typeof earnApyHourlySnapshots;
  earnForecastSnapshots: typeof earnForecastSnapshots;
  managedVaults: typeof managedVaults;
  rebalanceDecisions: typeof rebalanceDecisions;
  realtimeEvents: typeof realtimeEvents;
  routeLookupTables: typeof routeLookupTables;
  routePolicies: typeof routePolicies;
  solanaWeekQuestCompletions: typeof solanaWeekQuestCompletions;
  userYieldPositionDeposits: typeof userYieldPositionDeposits;
  userYieldPositionHoldingEvents: typeof userYieldPositionHoldingEvents;
  userYieldPositionWithdrawals: typeof userYieldPositionWithdrawals;
  userYieldPositions: typeof userYieldPositions;
  vaultPositionSnapshotPositions: typeof vaultPositionSnapshotPositions;
  vaultPositionSnapshots: typeof vaultPositionSnapshots;
  vaultIdleTokenBalancesCurrent: typeof vaultIdleTokenBalancesCurrent;
  vaultReservePositionsCurrent: typeof vaultReservePositionsCurrent;
};

export class YieldOptimizationClient {
  readonly db: YieldOptimizationDatabase;
  readonly tables: YieldOptimizationClientTables = {
    balanceSweepExecutions,
    balanceSweepExecutionLots,
    balanceSweepLotClaimItems,
    balanceSweepLotClaims,
    balanceSweepPolicies,
    balanceSweepSurplusLots,
    balanceSweepTargets,
    balanceSweepWalletBalanceEvents,
    balanceSweepWalletBalancesCurrent,
    earnDepositOnboardingAttempts,
    earnApyHourlySnapshots,
    earnForecastSnapshots,
    managedVaults,
    realtimeEvents,
    rebalanceDecisions,
    routeLookupTables,
    routePolicies,
    solanaWeekQuestCompletions,
    userYieldPositionDeposits,
    userYieldPositionHoldingEvents,
    userYieldPositionWithdrawals,
    userYieldPositions,
    vaultPositionSnapshotPositions,
    vaultPositionSnapshots,
    vaultIdleTokenBalancesCurrent,
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
