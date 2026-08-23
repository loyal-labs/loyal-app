import "server-only";

import { sql } from "drizzle-orm";

import { getYieldOptimizationClient } from "@/lib/yield-optimization/yield-neon-client.server";

const EARN_MAX_VAULT_INDEX = 0;

type QueryResult = { rows?: unknown[] } | unknown[];

function rows(result: QueryResult): Record<string, unknown>[] {
  const values = Array.isArray(result) ? result : (result.rows ?? []);
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

export async function readEarnMaxHistory(settings: string) {
  const client = getYieldOptimizationClient();
  const [operationsResult, snapshotsResult] = await Promise.all([
    client.db.execute(sql`
      SELECT operation.*
      FROM loyal_yield.multiply_operations operation
      INNER JOIN loyal_yield.multiply_route_states route
        ON route.route_key = operation.route_key
      WHERE route.settings = ${settings}
        AND route.vault_index = ${EARN_MAX_VAULT_INDEX}
      ORDER BY operation.created_at DESC, operation.operation_id DESC
      LIMIT 100
    `),
    client.db.execute(sql`
      SELECT snapshot.*
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

type WithdrawalRequest = {
  amountRaw: bigint | "max";
  destination: string;
  idempotencyKey: string;
  settings: string;
};

function numericBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

export class EarnMaxWithdrawalConflict extends Error {}

export async function requestEarnMaxWithdrawal(input: WithdrawalRequest) {
  const client = getYieldOptimizationClient();
  const currentResult = await client.db.execute(sql`
    SELECT route_key, state, state_version
    FROM loyal_yield.multiply_route_states
    WHERE settings = ${input.settings}
      AND vault_index = ${EARN_MAX_VAULT_INDEX}
    LIMIT 1
  `);
  const current = rows(currentResult as QueryResult)[0];
  if (!current) throw new Error("Earn MAX route is not ready.");
  const state = current.state;
  if (typeof state !== "object" || state === null) {
    throw new Error("Earn MAX route state is invalid.");
  }
  const routeState = state as Record<string, unknown>;
  const existing = routeState.withdrawal;
  if (typeof existing === "object" && existing !== null) {
    const withdrawal = existing as Record<string, unknown>;
    if (withdrawal.requestId === input.idempotencyKey) {
      return routeState;
    }
    if (withdrawal.status !== "claimed") {
      throw new EarnMaxWithdrawalConflict(
        "Another Earn MAX withdrawal is already active."
      );
    }
  }
  if (routeState.currentOperationId !== null) {
    throw new EarnMaxWithdrawalConflict(
      "Earn MAX is finishing another capital movement."
    );
  }

  let amountRaw = input.amountRaw;
  if (amountRaw === "max") {
    const latestResult = await client.db.execute(sql`
      SELECT equity_usd_micros
      FROM loyal_yield.multiply_position_snapshots
      WHERE route_key = ${String(current.route_key)}
      ORDER BY observed_slot DESC, id DESC
      LIMIT 1
    `);
    const latest = rows(latestResult as QueryResult)[0];
    amountRaw = numericBigInt(latest?.equity_usd_micros) ?? BigInt(0);
  }
  if (amountRaw <= BigInt(0) || amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Earn MAX withdrawal amount is unavailable or out of range.");
  }

  const requestedAt = new Date();
  const claimableAt = new Date(requestedAt.getTime() + 10 * 60 * 1000);
  const generation = numericBigInt(routeState.generation);
  const stateVersion = numericBigInt(current.state_version);
  if (generation === null || stateVersion === null || generation !== stateVersion) {
    throw new Error("Earn MAX route generation drifted.");
  }
  const nextGeneration = generation + BigInt(1);
  const next = {
    ...routeState,
    generation: Number(nextGeneration),
    goal: "withdraw",
    withdrawal: {
      amountRaw: Number(amountRaw),
      claimSignature: null,
      claimableAt: claimableAt.toISOString(),
      destinationAccount: input.destination,
      requestId: input.idempotencyKey,
      requestedAt: requestedAt.toISOString(),
      status: "requested",
      unwindCompletedAt: null,
    },
    frontend: {
      ...(routeState.frontend as Record<string, unknown>),
      generation: Number(nextGeneration),
      status: "withdrawing",
      withdrawalStatus: "requested",
    },
  };
  const updateResult = await client.db.execute(sql`
    UPDATE loyal_yield.multiply_route_states
    SET state = ${JSON.stringify(next)}::jsonb,
        state_version = state_version + 1,
        updated_at = now()
    WHERE route_key = ${String(current.route_key)}
      AND state_version = ${stateVersion}
      AND state ->> 'currentOperationId' IS NULL
    RETURNING state
  `);
  const updated = rows(updateResult as QueryResult)[0];
  if (!updated) {
    throw new EarnMaxWithdrawalConflict(
      "Earn MAX state changed while requesting withdrawal."
    );
  }
  return updated.state;
}

export { EARN_MAX_VAULT_INDEX };
