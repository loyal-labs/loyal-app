import "server-only";

import { getYieldNeonSql } from "@/lib/yield-optimization/yield-neon-client.server";

type SqlScalar = string | number | bigint | null;

export type EarnActiveReserveRouteRow = {
  activeAumRaw: bigint;
  currentReserve: string;
  latestObservedAt: string | null;
  positionCount: number;
};

export type EarnRebalanceDecisionRow = {
  abandonReason: string | null;
  amountRaw: bigint | null;
  confirmedSlot: bigint | null;
  createdAt: string;
  decisionReason: string | null;
  decisionType: "autodeposit" | "rebalance" | null;
  estimatedEdgeBps: number | null;
  id: string;
  signature: string | null;
  sourceApyBps: number | null;
  sourceReserve: string | null;
  status: string;
  targetApyBps: number | null;
  targetReserve: string | null;
  updatedAt: string;
};

type ActiveReserveRouteSqlRow = {
  active_aum_raw: SqlScalar;
  current_reserve: string;
  latest_observed_at: Date | string | null;
  position_count: SqlScalar;
};

type RebalanceDecisionSqlRow = {
  abandon_reason: string | null;
  amount_raw: SqlScalar;
  confirmed_slot: SqlScalar;
  created_at: Date | string;
  decision_reason: string | null;
  estimated_edge_bps: SqlScalar;
  id: string | number | bigint;
  signature: string | null;
  source_apy_bps: SqlScalar;
  source_reserve: string | null;
  status: string;
  target_apy_bps: SqlScalar;
  target_reserve: string | null;
  updated_at: Date | string;
};

function toBigInt(value: SqlScalar | undefined): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string" && value.length > 0) {
    return BigInt(value);
  }

  return BigInt(0);
}

function toNullableBigInt(value: SqlScalar | undefined): bigint | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return toBigInt(value);
}

function toNumber(value: SqlScalar | undefined): number {
  return Number(toBigInt(value));
}

function toNullableNumber(value: SqlScalar | undefined): number | null {
  const bigintValue = toNullableBigInt(value);
  return bigintValue === null ? null : Number(bigintValue);
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function queryRows<T>(query: string): Promise<T[]> {
  return getYieldNeonSql().query(query) as unknown as Promise<T[]>;
}

function getDecisionType(
  row: Pick<
    RebalanceDecisionSqlRow,
    "decision_reason" | "source_reserve" | "target_reserve"
  >
): EarnRebalanceDecisionRow["decisionType"] {
  if (row.decision_reason === "idle_vault_liquidity_available") {
    return "autodeposit";
  }

  if (row.source_reserve && row.target_reserve) {
    return "rebalance";
  }

  return null;
}

export async function getActiveReserveRoutes(): Promise<
  EarnActiveReserveRouteRow[]
> {
  const rows = await queryRows<ActiveReserveRouteSqlRow>(
    `
      WITH reserve_rows AS (
        SELECT
          reserve.reserve AS current_reserve,
          reserve.observed_at,
          vault.id AS vault_id,
          reserve.amount_raw,
          COALESCE(
            reserve.planning_metadata->>'amountSemantics',
            reserve.planning_metadata->>'amount_semantics'
          ) AS amount_semantics,
          COALESCE(
            reserve.planning_metadata->>'redeemable_liquidity_amount_raw',
            reserve.planning_metadata->>'redeemable_source_liquidity_amount_raw'
          ) AS redeemable_amount_raw_text
        FROM loyal_yield.managed_vaults AS vault
        INNER JOIN loyal_yield.vault_reserve_positions_current AS reserve
          ON reserve.vault_id = vault.id
        WHERE vault.active = true
          AND vault.vault_index = 1
          AND reserve.has_value = true
          AND reserve.amount_raw > 0
      ),
      normalized_reserve_rows AS (
        SELECT
          current_reserve,
          observed_at,
          vault_id,
          CASE
            WHEN amount_semantics IN (
              'kamino_redeemable_liquidity',
              'redeemable_liquidity_amount'
            )
              THEN amount_raw
            WHEN amount_semantics = 'kamino_obligation_collateral_deposited_amount'
              AND redeemable_amount_raw_text ~ '^[0-9]+$'
              THEN redeemable_amount_raw_text::bigint
            ELSE 0::bigint
          END AS normalized_amount_raw
        FROM reserve_rows
      )
      SELECT
        current_reserve,
        COUNT(DISTINCT vault_id)::text AS position_count,
        COALESCE(SUM(normalized_amount_raw), 0)::text AS active_aum_raw,
        MAX(observed_at) AS latest_observed_at
      FROM normalized_reserve_rows
      WHERE normalized_amount_raw > 0
      GROUP BY current_reserve
      ORDER BY COALESCE(SUM(normalized_amount_raw), 0) DESC
    `
  );

  return rows.map((row) => ({
    activeAumRaw: toBigInt(row.active_aum_raw),
    currentReserve: row.current_reserve,
    latestObservedAt: toIsoString(row.latest_observed_at),
    positionCount: toNumber(row.position_count),
  }));
}

export async function getRecentRebalanceDecisions(): Promise<
  EarnRebalanceDecisionRow[]
> {
  const rows = await queryRows<RebalanceDecisionSqlRow>(
    `
      SELECT
        id::text,
        status::text,
        source_reserve,
        target_reserve,
        amount_raw::text,
        source_apy_bps::text,
        target_apy_bps::text,
        estimated_edge_bps::text,
        decision_reason::text,
        abandon_reason,
        signature,
        confirmed_slot::text,
        created_at,
        updated_at
      FROM loyal_yield.rebalance_decisions
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
  );

  return rows.map((row) => ({
    abandonReason: row.abandon_reason,
    amountRaw: toNullableBigInt(row.amount_raw),
    confirmedSlot: toNullableBigInt(row.confirmed_slot),
    createdAt: toIsoString(row.created_at) ?? "",
    decisionReason: row.decision_reason,
    decisionType: getDecisionType(row),
    estimatedEdgeBps: toNullableNumber(row.estimated_edge_bps),
    id: String(row.id),
    signature: row.signature,
    sourceApyBps: toNullableNumber(row.source_apy_bps),
    sourceReserve: row.source_reserve,
    status: row.status,
    targetApyBps: toNullableNumber(row.target_apy_bps),
    targetReserve: row.target_reserve,
    updatedAt: toIsoString(row.updated_at) ?? "",
  }));
}
