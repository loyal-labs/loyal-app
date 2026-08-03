import "server-only";

import { appUsers } from "@loyal-labs/db-core/schema";
import { neon } from "@neondatabase/serverless";
import { count } from "drizzle-orm";

import { serverEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";

import type { LoyalStats } from "./stats-command";

const EARN_AUM_START_DATE = "2026-06-15";
const STATS_QUERY_TIMEOUT_MS = 50_000;
const ACTIVE_EARN_HOLDINGS_CTE = `
  refresh_lock AS MATERIALIZED (
    SELECT pg_try_advisory_xact_lock(
      hashtextextended('loyal_stats_snapshot_refresh', 0)
    ) AS acquired
  ),
  active_positions AS (
    SELECT
      position.id AS position_id,
      position.wallet_address,
      position.settings,
      position.principal_amount_raw,
      position.deposit_mint,
      vault.id AS vault_id
    FROM loyal_yield.user_yield_positions AS position
    LEFT JOIN loyal_yield.managed_vaults AS vault
      ON vault.settings = position.settings
      AND vault.vault_index = position.vault_index
      AND vault.vault_pubkey = position.vault_pubkey
      AND vault.active = true
    WHERE position.status = 'active'
      AND (SELECT acquired FROM refresh_lock)
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
      COALESCE(reserve.normalized_reserve_raw, 0::bigint)
        + COALESCE(idle.idle_raw, 0::bigint) AS normalized_aum_raw
    FROM active_positions AS active
    LEFT JOIN normalized_reserve_by_position AS reserve
      ON reserve.position_id = active.position_id
    LEFT JOIN idle_by_position AS idle
      ON idle.position_id = active.position_id
  )
`;

type YieldStatsRow = {
  active_autodeposit_policies: string | number | bigint | null;
  active_principal_raw: string | number | bigint | null;
  earn_aum_series: unknown;
  total_aum_raw: string | number | bigint | null;
  total_optimized_volume_raw: string | number | bigint | null;
  unique_earn_policies: string | number | bigint | null;
  unique_earn_users: string | number | bigint | null;
};

export type LoyalStatsRefresh = LoyalStats & {
  activeAutodepositPolicies: number;
  activePrincipalRaw: bigint;
  earnAumSeries: {
    aumRaw: string;
    weekEnd: string;
    weekStart: string;
  }[];
  uniqueEarnPolicies: number;
  uniqueEarnUsers: number;
};

let yieldNeonSql: ReturnType<typeof neon> | null = null;

function getYieldNeonSql(): ReturnType<typeof neon> {
  if (!yieldNeonSql) {
    yieldNeonSql = neon(serverEnv.yieldNeonDatabaseUrl);
  }

  return yieldNeonSql;
}

function parseRawMetric(
  value: string | number | bigint | null | undefined,
  label: string
): bigint {
  try {
    const parsed = BigInt(value ?? "");
    if (parsed < BigInt(0)) {
      throw new Error("negative value");
    }
    return parsed;
  } catch {
    throw new Error(`Invalid ${label} returned by Yield Neon`);
  }
}

function parseCountMetric(
  value: string | number | bigint | null | undefined,
  label: string
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label} returned by Yield Neon`);
  }
  return parsed;
}

function parseAumSeries(value: unknown): LoyalStatsRefresh["earnAumSeries"] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid Earn AUM series returned by Yield Neon");
  }

  return value.map((point) => {
    if (
      !point ||
      typeof point !== "object" ||
      typeof (point as { aumRaw?: unknown }).aumRaw !== "string" ||
      typeof (point as { weekEnd?: unknown }).weekEnd !== "string" ||
      typeof (point as { weekStart?: unknown }).weekStart !== "string"
    ) {
      throw new Error("Invalid Earn AUM series point returned by Yield Neon");
    }

    const parsed = point as {
      aumRaw: string;
      weekEnd: string;
      weekStart: string;
    };
    parseRawMetric(parsed.aumRaw, "Earn AUM series value");
    return parsed;
  });
}

export async function loadLoyalStats(): Promise<LoyalStatsRefresh | null> {
  const database = getDatabase();
  const sql = getYieldNeonSql();

  const [userCountRows, transactionResults] = await Promise.all([
    database.select({ value: count() }).from(appUsers),
    sql.transaction((txn) => [
      txn.query(`SET LOCAL statement_timeout = '${STATS_QUERY_TIMEOUT_MS}ms'`),
      txn.query(`
        WITH
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
          WHERE (SELECT acquired FROM refresh_lock)
        ),
        weekly_aum AS (
          SELECT
            weeks.week_start,
            weeks.week_end,
            CASE
              WHEN weeks.week_end = (SELECT current_day FROM current_bounds)
                THEN (SELECT aum_raw FROM current_aum)
              ELSE COALESCE(SUM(latest.amount_raw), 0)::bigint
            END AS aum_raw
          FROM weeks
          LEFT JOIN latest_by_position AS latest
            ON latest.week_start = weeks.week_start
            AND latest.rank = 1
          GROUP BY weeks.week_start, weeks.week_end
          ORDER BY weeks.week_start ASC
        )
        SELECT
          (SELECT aum_raw FROM current_aum)::text AS total_aum_raw,
          (
            SELECT COALESCE(SUM(principal_amount_raw), 0)::text
            FROM active_positions
          ) AS active_principal_raw,
          (
            SELECT COALESCE(SUM(decision.amount_raw), 0)::text
            FROM loyal_yield.rebalance_decisions AS decision
            WHERE decision.status = 'confirmed'
              AND decision.signature IS NOT NULL
              AND decision.amount_raw IS NOT NULL
          ) AS total_optimized_volume_raw,
          (
            SELECT COUNT(DISTINCT COALESCE(NULLIF(wallet_address, ''), settings))::text
            FROM active_positions
          ) AS unique_earn_users,
          (
            SELECT COUNT(DISTINCT policy_account)::text
            FROM loyal_yield.route_policies
            WHERE active = true
          ) AS unique_earn_policies,
          (
            SELECT COUNT(DISTINCT policy.policy_account)::text
            FROM loyal_yield.balance_sweep_policies AS policy
            INNER JOIN loyal_yield.balance_sweep_targets AS target
              ON target.balance_sweep_policy_id = policy.id
            WHERE policy.active = true
              AND target.active = true
              AND target.lifecycle_status = 'active'
          ) AS active_autodeposit_policies,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'weekStart', to_char(week_start, 'YYYY-MM-DD'),
                  'weekEnd', to_char(week_end, 'YYYY-MM-DD'),
                  'aumRaw', aum_raw::text
                )
                ORDER BY week_start
              )
              FROM weekly_aum
            ),
            '[]'::jsonb
          ) AS earn_aum_series
        FROM refresh_lock
        WHERE acquired
      `),
    ]),
  ]);

  const totalUsers = userCountRows[0]?.value;
  const yieldRows = transactionResults[1] as unknown as YieldStatsRow[];
  const yieldStats = yieldRows[0];
  if (!yieldStats) {
    return null;
  }
  if (!Number.isSafeInteger(totalUsers) || totalUsers < 0) {
    throw new Error("Invalid Loyal stats query result");
  }

  return {
    activeAutodepositPolicies: parseCountMetric(
      yieldStats.active_autodeposit_policies,
      "active Autodeposit policy count"
    ),
    activePrincipalRaw: parseRawMetric(
      yieldStats.active_principal_raw,
      "active principal"
    ),
    earnAumSeries: parseAumSeries(yieldStats.earn_aum_series),
    totalAumRaw: parseRawMetric(yieldStats.total_aum_raw, "total AUM"),
    totalOptimizedVolumeRaw: parseRawMetric(
      yieldStats.total_optimized_volume_raw,
      "total optimized volume"
    ),
    totalUsers,
    uniqueEarnPolicies: parseCountMetric(
      yieldStats.unique_earn_policies,
      "unique Earn policy count"
    ),
    uniqueEarnUsers: parseCountMetric(
      yieldStats.unique_earn_users,
      "unique Earn user count"
    ),
  };
}
