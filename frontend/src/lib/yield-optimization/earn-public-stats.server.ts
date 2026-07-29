import "server-only";

import { appUsers } from "@loyal-labs/db-core/schema";
import { count, sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { getYieldOptimizationClient } from "@/lib/yield-optimization/yield-neon-client.server";

// Port of dashboard/src/lib/performance-snapshot.ts — the public dashboard's
// metric definitions, reused verbatim so the in-app Stats panel always shows
// the same numbers as the public dashboard. Keep the SQL in sync with that
// file when either side changes.
const USDC_DECIMALS = 6;
const EARN_AUM_START_DATE = "2026-06-15";
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_EARN_HOLDINGS_CTE = `
  WITH active_positions AS (
    SELECT
      position.id AS position_id,
      position.principal_amount_raw,
      position.current_observed_at,
      position.deposit_mint,
      vault.id AS vault_id
    FROM loyal_yield.user_yield_positions AS position
    LEFT JOIN loyal_yield.managed_vaults AS vault
      ON vault.settings = position.settings
      AND vault.vault_index = position.vault_index
      AND vault.vault_pubkey = position.vault_pubkey
      AND vault.active = true
    WHERE position.status = 'active'
  ),
  reserve_rows AS (
    SELECT
      active.position_id,
      reserve.amount_raw,
      COALESCE(
        reserve.planning_metadata->>'amountSemantics',
        reserve.planning_metadata->>'amount_semantics'
      ) AS amount_semantics,
      COALESCE(
        reserve.planning_metadata->>'redeemable_liquidity_amount_raw',
        reserve.planning_metadata->>'redeemable_source_liquidity_amount_raw'
      ) AS redeemable_amount_raw_text
    FROM active_positions AS active
    INNER JOIN loyal_yield.vault_reserve_positions_current AS reserve
      ON reserve.vault_id = active.vault_id
  ),
  normalized_reserve_by_position AS (
    SELECT
      position_id,
      COALESCE(SUM(
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
        END
      ), 0)::bigint AS normalized_reserve_raw
    FROM reserve_rows
    GROUP BY position_id
  ),
  idle_by_position AS (
    SELECT
      active.position_id,
      COALESCE(SUM(idle.amount_raw), 0)::bigint AS idle_raw
    FROM active_positions AS active
    INNER JOIN loyal_yield.vault_idle_token_balances_current AS idle
      ON idle.vault_id = active.vault_id
      AND idle.mint = active.deposit_mint
    GROUP BY active.position_id
  ),
  normalized_active_positions AS (
    SELECT
      active.position_id,
      active.principal_amount_raw,
      active.current_observed_at,
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        AS normalized_reserve_raw,
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        + COALESCE(idle.idle_raw, 0::bigint) AS normalized_aum_raw
    FROM active_positions AS active
    LEFT JOIN normalized_reserve_by_position AS reserve
      ON reserve.position_id = active.position_id
    LEFT JOIN idle_by_position AS idle
      ON idle.position_id = active.position_id
  )
`;

const AUM_SERIES_QUERY = `
  ${ACTIVE_EARN_HOLDINGS_CTE},
  current_bounds AS (
    SELECT date_trunc('day', now() AT TIME ZONE 'UTC')::date AS current_day
  ),
  current_aum AS (
    SELECT COALESCE(SUM(normalized_aum_raw), 0)::bigint AS aum_raw
    FROM normalized_active_positions
  ),
  raw_weeks AS (
    SELECT generated.week_start::date AS week_start
    FROM generate_series(
      DATE '${EARN_AUM_START_DATE}',
      date_trunc('week', now() AT TIME ZONE 'UTC')::date,
      interval '1 week'
    ) AS generated(week_start)
  ),
  weeks AS (
    SELECT
      raw_weeks.week_start,
      LEAST(
        (raw_weeks.week_start + interval '6 days')::date,
        (SELECT current_day FROM current_bounds)
      )::date AS week_end,
      LEAST(
        (
          (raw_weeks.week_start + interval '7 days')::timestamp
          AT TIME ZONE 'UTC'
        ),
        (
          ((SELECT current_day FROM current_bounds) + interval '1 day')::timestamp
          AT TIME ZONE 'UTC'
        )
      ) AS week_end_exclusive
    FROM raw_weeks
  ),
  latest_by_position AS (
    SELECT
      weeks.week_start,
      event.position_id,
      event.amount_raw,
      row_number() OVER (
        PARTITION BY weeks.week_start, event.position_id
        ORDER BY event.observed_at DESC, event.id DESC
      ) AS rank
    FROM weeks
    INNER JOIN loyal_yield.user_yield_position_holding_events AS event
      ON event.observed_at < weeks.week_end_exclusive
  )
  SELECT
    to_char(weeks.week_start, 'YYYY-MM-DD') AS week_start,
    to_char(weeks.week_end, 'YYYY-MM-DD') AS week_end,
    CASE
      WHEN weeks.week_end = (SELECT current_day FROM current_bounds)
        THEN (SELECT aum_raw FROM current_aum)
      ELSE COALESCE(SUM(latest.amount_raw), 0)::bigint
    END::text AS aum_raw
  FROM weeks
  LEFT JOIN latest_by_position AS latest
    ON latest.week_start = weeks.week_start
    AND latest.rank = 1
  GROUP BY weeks.week_start, weeks.week_end
  ORDER BY weeks.week_start ASC
`;

const HEADLINE_QUERY = `
  ${ACTIVE_EARN_HOLDINGS_CTE}
  SELECT
    COALESCE(SUM(normalized_aum_raw), 0)::text AS active_aum_raw,
    (
      SELECT COALESCE(SUM(decision.amount_raw), 0)::text
      FROM loyal_yield.rebalance_decisions AS decision
      WHERE decision.status = 'confirmed'
        AND decision.signature IS NOT NULL
        AND decision.amount_raw IS NOT NULL
    ) AS optimization_volume_raw
  FROM normalized_active_positions
`;

export type EarnPublicStatsSeriesPoint = {
  label: string;
  periodLabel: string;
  value: number;
};

export type EarnPublicStats = {
  aumUsd: number;
  aumDeltaVsPriorWeekUsd: number | null;
  aumSeries: EarnPublicStatsSeriesPoint[];
  optimizationVolumeUsd: number;
  totalUsers: number;
};

const dateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function toBigInt(value: unknown): bigint {
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

function rawToUsdc(raw: bigint): number {
  return Number(raw) / 10 ** USDC_DECIMALS;
}

function formatDateLabel(value: string): string {
  return dateLabelFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function getExecuteRows(result: unknown): Record<string, unknown>[] {
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  return [];
}

async function loadEarnPublicStats(): Promise<EarnPublicStats> {
  const yieldDb = getYieldOptimizationClient().db;
  const database = getDatabase();

  const [seriesResult, headlineResult, userCountRows] = await Promise.all([
    yieldDb.execute(sql.raw(AUM_SERIES_QUERY)),
    yieldDb.execute(sql.raw(HEADLINE_QUERY)),
    database.select({ value: count() }).from(appUsers),
  ]);

  const seriesRows = getExecuteRows(seriesResult);
  const headline = getExecuteRows(headlineResult)[0];
  const totalUsers = userCountRows[0]?.value;
  if (typeof totalUsers !== "number") {
    throw new Error("Failed to load total Loyal user count");
  }

  const seriesRaw = seriesRows.map((row) => ({
    endLabel: formatDateLabel(String(row.week_end)),
    label: formatDateLabel(String(row.week_start)),
    raw: toBigInt(row.aum_raw),
  }));
  const lastPoint = seriesRaw.at(-1);
  const priorPoint = seriesRaw.at(-2);

  return {
    aumUsd: rawToUsdc(toBigInt(headline?.active_aum_raw)),
    aumDeltaVsPriorWeekUsd:
      lastPoint && priorPoint
        ? rawToUsdc(lastPoint.raw - priorPoint.raw)
        : null,
    aumSeries: seriesRaw.map((point) => ({
      label: point.label,
      periodLabel: `${point.label} - ${point.endLabel}`,
      value: rawToUsdc(point.raw),
    })),
    optimizationVolumeUsd: rawToUsdc(toBigInt(headline?.optimization_volume_raw)),
    totalUsers,
  };
}

let cached: { expiresAt: number; value: EarnPublicStats } | null = null;
let inflight: Promise<EarnPublicStats> | null = null;

// The AUM series join is O(weeks × holding events) with no supporting index,
// and the volume sum is a full seq scan — never run them per page view.
export async function getEarnPublicStats(): Promise<EarnPublicStats> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (inflight) {
    return inflight;
  }
  inflight = loadEarnPublicStats()
    .then((value) => {
      cached = { expiresAt: Date.now() + STATS_CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
