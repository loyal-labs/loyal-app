import "server-only";

import { sql } from "drizzle-orm";

import { getYieldOptimizationClient } from "@/lib/yield-optimization/yield-neon-client.server";

import type {
  EarnMaxActivityResponse,
  EarnMaxPolicyBinding,
  EarnMaxSummary,
  EarnMaxWithdrawalView,
} from "../types";

const EARN_MAX_VAULT_INDEX = 0;

type QueryResult = { rows?: unknown[] } | unknown[];

function rows(result: QueryResult): Record<string, unknown>[] {
  const values = Array.isArray(result) ? result : result.rows ?? [];
  return values.filter(
    (value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rawString(value: unknown): string {
  return typeof value === "bigint" || typeof value === "number"
    ? String(value)
    : typeof value === "string" && /^-?\d+$/.test(value)
    ? value
    : "0";
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dollars(value: unknown): number {
  return Number(BigInt(rawString(value))) / 1_000_000;
}

function policyBindings(value: unknown): EarnMaxPolicyBinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const binding = record(entry);
    if (!binding || typeof binding.account !== "string") return [];
    return [
      {
        account: binding.account,
        matches: binding.matches === true,
        seed: rawString(binding.seed),
      },
    ];
  });
}

function withdrawalView(
  route: Record<string, unknown> | null
): EarnMaxWithdrawalView | null {
  const withdrawal = record(route?.withdrawal);
  const status = withdrawal?.status;
  if (
    !withdrawal ||
    !["requested", "unwinding", "claimable", "claimed"].includes(String(status))
  ) {
    return null;
  }
  return {
    amountRaw: rawString(withdrawal.amountRaw),
    canCancel: status === "requested" && route?.currentOperationId === null,
    canClaim: status === "claimable",
    readyBy: String(withdrawal.readyBy ?? ""),
    requestId: String(withdrawal.requestId ?? ""),
    status: status as EarnMaxWithdrawalView["status"],
  };
}

export async function readEarnMaxSummary(
  settings: string
): Promise<EarnMaxSummary | null> {
  const result = await getYieldOptimizationClient().db.execute(sql`
    SELECT
      route.state,
      policy.status AS policy_status,
      policy.policy_accounts,
      snapshot.equity_usd_micros,
      snapshot.claim_raw,
      snapshot.forecast_apy_bps,
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
      AND policy.manifest_version = 'earn-max-v2'
    LIMIT 1
  `);
  const row = rows(result as QueryResult)[0];
  if (!row) return null;
  const route = record(row.state);
  return {
    balanceUsd: dollars(row.equity_usd_micros),
    claimAmountRaw: rawString(row.claim_raw),
    coverage:
      row.performance_coverage === "complete"
        ? "complete"
        : "history_incomplete",
    currentOperationId:
      typeof route?.currentOperationId === "string"
        ? route.currentOperationId
        : null,
    earnedUsd:
      row.earned_usd_micros === null ? null : dollars(row.earned_usd_micros),
    forecastApyBps: nullableNumber(row.forecast_apy_bps),
    goal: typeof route?.goal === "string" ? route.goal : "not_installed",
    policyAccounts: policyBindings(row.policy_accounts),
    policyStatus:
      typeof row.policy_status === "string" ? row.policy_status : null,
    realizedApyBps: nullableNumber(row.realized_apy_bps),
    strategyKey:
      typeof record(route?.position)?.strategyKey === "string"
        ? String(record(route?.position)?.strategyKey)
        : null,
    withdrawal: withdrawalView(route),
  };
}

export async function readEarnMaxActivity(
  settings: string
): Promise<EarnMaxActivityResponse> {
  const client = getYieldOptimizationClient();
  const [operationsResult, snapshotsResult] = await Promise.all([
    client.db.execute(sql`
      SELECT
        operation.operation_id,
        operation.action,
        operation.status,
        operation.transaction_signature,
        operation.created_at,
        positive_delta.amount_raw
      FROM loyal_yield.multiply_operations operation
      INNER JOIN loyal_yield.multiply_route_states route
        ON route.route_key = operation.route_key
      LEFT JOIN LATERAL (
        SELECT COALESCE(MAX((delta ->> 'rawDelta')::NUMERIC), 0) AS amount_raw
        FROM jsonb_array_elements(operation.expected_effects -> 'tokenDeltas') delta
        WHERE (delta ->> 'rawDelta')::NUMERIC > 0
      ) positive_delta ON TRUE
      WHERE route.settings = ${settings}
        AND route.vault_index = ${EARN_MAX_VAULT_INDEX}
        AND route.state ->> 'engineVersion' = 'earn_max_v2'
      ORDER BY operation.created_at DESC, operation.operation_id DESC
      LIMIT 100
    `),
    client.db.execute(sql`
      SELECT
        snapshot.observed_at,
        snapshot.equity_usd_micros,
        snapshot.valuation_observed_at
      FROM loyal_yield.multiply_position_snapshots snapshot
      INNER JOIN loyal_yield.multiply_route_states route
        ON route.route_key = snapshot.route_key
      WHERE route.settings = ${settings}
        AND route.vault_index = ${EARN_MAX_VAULT_INDEX}
        AND route.state ->> 'engineVersion' = 'earn_max_v2'
      ORDER BY snapshot.observed_slot DESC, snapshot.id DESC
      LIMIT 500
    `),
  ]);
  const operations = rows(operationsResult as QueryResult).map((operation) => ({
    action: String(operation.action ?? "activity"),
    amountRaw:
      operation.amount_raw == null || rawString(operation.amount_raw) === "0"
        ? null
        : rawString(operation.amount_raw),
    id: String(operation.operation_id ?? ""),
    signature:
      typeof operation.transaction_signature === "string"
        ? operation.transaction_signature
        : null,
    status: String(operation.status ?? "unknown"),
    timestamp: String(operation.created_at ?? ""),
  }));
  const performance = rows(snapshotsResult as QueryResult)
    .flatMap((snapshot) => {
      const equity = nullableNumber(snapshot.equity_usd_micros);
      const timestamp = String(
        snapshot.valuation_observed_at ?? snapshot.observed_at ?? ""
      );
      return equity === null || timestamp.length === 0
        ? []
        : [{ equityUsd: equity / 1_000_000, timestamp }];
    })
    .reverse();
  return {
    operations,
    performance,
  };
}

export { EARN_MAX_VAULT_INDEX };
