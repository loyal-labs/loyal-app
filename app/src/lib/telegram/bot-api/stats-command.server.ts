import "server-only";

import { appUsers } from "@loyal-labs/db-core/schema";
import { neon } from "@neondatabase/serverless";
import { count } from "drizzle-orm";

import { serverEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";

import type { LoyalStats } from "./stats-command";

const ACTIVE_EARN_HOLDINGS_CTE = `
  WITH active_positions AS (
    SELECT
      position.id AS position_id,
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
  total_aum_raw: string | number | bigint | null;
  total_optimized_volume_raw: string | number | bigint | null;
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

export async function loadLoyalStats(): Promise<LoyalStats> {
  const database = getDatabase();
  const sql = getYieldNeonSql();

  const [userCountRows, yieldRows] = await Promise.all([
    database.select({ value: count() }).from(appUsers),
    sql.query(
      `
        ${ACTIVE_EARN_HOLDINGS_CTE}
        SELECT
          COALESCE(SUM(normalized_aum_raw), 0)::text AS total_aum_raw,
          (
            SELECT COALESCE(SUM(decision.amount_raw), 0)::text
            FROM loyal_yield.rebalance_decisions AS decision
            WHERE decision.status = 'confirmed'
              AND decision.signature IS NOT NULL
              AND decision.amount_raw IS NOT NULL
          ) AS total_optimized_volume_raw
        FROM normalized_active_positions
      `
    ) as unknown as Promise<YieldStatsRow[]>,
  ]);

  const totalUsers = userCountRows[0]?.value;
  const yieldStats = yieldRows[0];
  if (!Number.isSafeInteger(totalUsers) || totalUsers < 0 || !yieldStats) {
    throw new Error("Invalid Loyal stats query result");
  }

  return {
    totalAumRaw: parseRawMetric(yieldStats.total_aum_raw, "total AUM"),
    totalOptimizedVolumeRaw: parseRawMetric(
      yieldStats.total_optimized_volume_raw,
      "total optimized volume"
    ),
    totalUsers,
  };
}
