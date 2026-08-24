import "server-only";

import { sql } from "drizzle-orm";

import { getYieldOptimizationClient } from "@/lib/yield-optimization/yield-neon-client.server";

const EARN_MAX_VAULT_INDEX = 0;

type QueryResult = { rows?: unknown[] } | unknown[];

function rows(result: QueryResult): Record<string, unknown>[] {
  const values = Array.isArray(result) ? result : result.rows ?? [];
  return values.filter(
    (value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null
  );
}

export async function readEarnMaxState(settings: string) {
  const result = await getYieldOptimizationClient().db.execute(sql`
    SELECT
      route.route_key,
      route.state,
      route.state_version,
      route.updated_at,
      policy.manifest_version,
      policy.manifest_sha256,
      policy.status AS policy_status,
      policy.policy_accounts,
      policy.observed_signature AS policy_observed_signature,
      policy.observed_slot AS policy_observed_slot,
      snapshot.equity_usd_micros,
      snapshot.claim_raw,
      snapshot.collateral_raw,
      snapshot.debt_raw,
      snapshot.collateral_value_usd_micros,
      snapshot.debt_value_usd_micros,
      snapshot.leverage_bps,
      snapshot.ltv_bps,
      snapshot.health_factor_ppm,
      snapshot.supply_apy_bps,
      snapshot.borrow_apy_bps,
      snapshot.forecast_apy_bps,
      snapshot.valuation_source,
      snapshot.valuation_slot,
      snapshot.valuation_observed_at,
      snapshot.coverage_start_at,
      cash.confirmed_deposit_raw,
      cash.confirmed_claim_raw,
      CASE
        WHEN snapshot.equity_usd_micros IS NULL THEN NULL
        ELSE snapshot.equity_usd_micros + cash.confirmed_claim_raw - cash.confirmed_deposit_raw
      END AS earned_usd_micros,
      CASE
        WHEN snapshot.coverage_start_at IS NULL
          OR cash.confirmed_deposit_raw <= 0
          OR EXTRACT(EPOCH FROM (now() - snapshot.coverage_start_at)) < 60
          OR snapshot.equity_usd_micros IS NULL
        THEN NULL
        ELSE ROUND(
          (snapshot.equity_usd_micros + cash.confirmed_claim_raw - cash.confirmed_deposit_raw)
          * 10000 * 31557600
          / cash.confirmed_deposit_raw
          / EXTRACT(EPOCH FROM (now() - snapshot.coverage_start_at))
        )
      END AS realized_apy_bps,
      CASE
        WHEN snapshot.coverage_start_at IS NULL OR cash.confirmed_deposit_raw <= 0
        THEN 'history_incomplete'
        ELSE 'complete'
      END AS performance_coverage
    FROM loyal_yield.earn_max_policy_sets policy
    LEFT JOIN loyal_yield.multiply_route_states route
      ON route.settings = policy.settings
     AND route.vault_index = policy.vault_index
    LEFT JOIN LATERAL (
      SELECT *
      FROM loyal_yield.multiply_position_snapshots current_snapshot
      WHERE current_snapshot.route_key = route.route_key
      ORDER BY current_snapshot.observed_slot DESC, current_snapshot.id DESC
      LIMIT 1
    ) snapshot ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(
          CASE WHEN operation.action = 'deposit_claim_asset'
            THEN positive_delta.amount_raw ELSE 0 END
        ), 0) AS confirmed_deposit_raw,
        COALESCE(SUM(
          CASE WHEN operation.action = 'claim'
            THEN positive_delta.amount_raw ELSE 0 END
        ), 0) AS confirmed_claim_raw
      FROM loyal_yield.multiply_operations operation
      LEFT JOIN LATERAL (
        SELECT COALESCE(MAX((delta ->> 'rawDelta')::NUMERIC), 0) AS amount_raw
        FROM jsonb_array_elements(operation.expected_effects -> 'tokenDeltas') delta
        WHERE (delta ->> 'rawDelta')::NUMERIC > 0
      ) positive_delta ON TRUE
      WHERE operation.route_key = route.route_key
        AND operation.status = 'reconciled'
    ) cash ON TRUE
    WHERE policy.settings = ${settings}
      AND policy.vault_index = ${EARN_MAX_VAULT_INDEX}
    LIMIT 1
  `);
  return rows(result as QueryResult)[0] ?? null;
}

export async function readEarnMaxActivity(settings: string) {
  const client = getYieldOptimizationClient();
  const [operationsResult, snapshotsResult] = await Promise.all([
    client.db.execute(sql`
      SELECT
        operation.operation_id,
        operation.action,
        operation.strategy_key,
        operation.status,
        operation.transaction_signature,
        operation.source_instruction_index,
        operation.confirmed_slot,
        operation.expected_effects,
        operation.created_at,
        operation.updated_at
      FROM loyal_yield.multiply_operations operation
      INNER JOIN loyal_yield.multiply_route_states route
        ON route.route_key = operation.route_key
      WHERE route.settings = ${settings}
        AND route.vault_index = ${EARN_MAX_VAULT_INDEX}
      ORDER BY operation.created_at DESC, operation.operation_id DESC
      LIMIT 100
    `),
    client.db.execute(sql`
      SELECT
        snapshot.id,
        snapshot.generation,
        snapshot.observed_slot,
        snapshot.observed_at,
        snapshot.strategy_key,
        snapshot.equity_usd_micros,
        snapshot.leverage_bps,
        snapshot.ltv_bps,
        snapshot.health_factor_ppm,
        snapshot.forecast_apy_bps,
        snapshot.valuation_source,
        snapshot.valuation_slot,
        snapshot.valuation_observed_at,
        snapshot.coverage_start_at
      FROM loyal_yield.multiply_position_snapshots snapshot
      INNER JOIN loyal_yield.multiply_route_states route
        ON route.route_key = snapshot.route_key
      WHERE route.settings = ${settings}
        AND route.vault_index = ${EARN_MAX_VAULT_INDEX}
      ORDER BY snapshot.observed_slot DESC, snapshot.id DESC
      LIMIT 500
    `),
  ]);
  return {
    operations: rows(operationsResult as QueryResult),
    snapshots: rows(snapshotsResult as QueryResult),
  };
}

export async function readEarnMaxPerformance(settings: string) {
  const state = await readEarnMaxState(settings);
  if (!state) return null;
  return {
    coverage_start_at: state.coverage_start_at,
    earned_usd_micros: state.earned_usd_micros,
    equity_usd_micros: state.equity_usd_micros,
    forecast_apy_bps: state.forecast_apy_bps,
    performance_coverage: state.performance_coverage,
    realized_apy_bps: state.realized_apy_bps,
    valuation_observed_at: state.valuation_observed_at,
    valuation_slot: state.valuation_slot,
  };
}

export { EARN_MAX_VAULT_INDEX };
