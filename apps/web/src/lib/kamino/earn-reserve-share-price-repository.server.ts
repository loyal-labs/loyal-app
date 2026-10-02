import "server-only";

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";

import {
  earnReserveSharePrices,
  getYieldOptimizationClient,
  managedVaults,
  userYieldPositions,
  vaultIdleTokenBalancesCurrent,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  type YieldOptimizationClient,
} from "@/lib/yield-optimization/yield-neon-client.server";

import type {
  EarnAllocationHistory,
  SharePricePoint,
} from "./earn-realized-apy.shared";

function safeRawAmount(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    typeof value !== "string" &&
    typeof value !== "bigint"
  ) {
    return null;
  }
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export type ReserveSharePriceRow = {
  reserve: string;
  market: string;
  liquidityMint: string;
  sharePrice: number;
  observedAt: Date;
  observedHour: Date;
  slot: number;
};

export async function upsertReserveSharePrices(
  cluster: string,
  rows: readonly ReserveSharePriceRow[],
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await client.db
    .insert(earnReserveSharePrices)
    .values(
      rows.map((row) => ({
        cluster,
        liquidityMint: row.liquidityMint,
        market: row.market,
        observedAt: row.observedAt,
        observedHour: row.observedHour,
        reserve: row.reserve,
        sharePrice: row.sharePrice,
        slot: BigInt(row.slot),
      }))
    )
    .onConflictDoUpdate({
      target: [
        earnReserveSharePrices.cluster,
        earnReserveSharePrices.reserve,
        earnReserveSharePrices.observedHour,
      ],
      set: {
        observedAt: sql`excluded.observed_at`,
        sharePrice: sql`excluded.share_price`,
        slot: sql`excluded.slot`,
      },
      // A delayed overlapping cron must not replace newer reserve state.
      setWhere: sql`excluded.slot > ${earnReserveSharePrices.slot}
        OR (excluded.slot = ${earnReserveSharePrices.slot}
          AND excluded.observed_at >= ${earnReserveSharePrices.observedAt})`,
    });
}

// Loyal Earn positions live in vault 1; vault 0 is agent-managed and must not
// weight the Earn APY.
const EARN_VAULT_INDEX = 1;

// Earn AUM per current reserve, in raw token units. Every Earn product
// stablecoin has 6 decimals, so raw sums are comparable across reserves.
export async function loadEarnAumWeightsByReserve(
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<Map<string, number>> {
  const rows = await client.db
    .select({
      amountRaw: sql<string>`sum(${userYieldPositions.currentAmountRaw})`,
      reserve: userYieldPositions.currentReserve,
    })
    .from(userYieldPositions)
    .where(
      and(
        eq(userYieldPositions.status, "active"),
        eq(userYieldPositions.vaultIndex, EARN_VAULT_INDEX)
      )
    )
    .groupBy(userYieldPositions.currentReserve);

  const weights = new Map<string, number>();
  for (const row of rows) {
    const amount = Number(row.amountRaw);
    if (Number.isFinite(amount) && amount > 0) {
      weights.set(row.reserve, amount);
    }
  }
  return weights;
}

// Complete vault snapshots record the fleet allocation, including concurrent
// reserves and idle capital. Sample the last snapshot as of each hour and
// aggregate in PostgreSQL; a rebalance within an hour takes effect at the next
// sample. The API never transfers a fleet-sized snapshot history.
export async function loadEarnAllocationHistory(
  sinceMs: number,
  nowMs: number,
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<EarnAllocationHistory> {
  const start = new Date(
    Math.floor(sinceMs / (60 * 60 * 1000)) * 60 * 60 * 1000
  );
  const end = new Date(nowMs);
  const result = await client.db.execute(sql`
    WITH hours AS (
      SELECT generate_series(${start}::timestamptz,
        date_trunc('hour', ${end}::timestamptz), interval '1 hour') AS hour
      UNION SELECT ${end}::timestamptz
    ),
    seed AS (
      SELECT DISTINCT ON (snapshot.vault_id) snapshot.*
      FROM ${vaultPositionSnapshots} AS snapshot
      JOIN ${managedVaults} AS vault ON vault.id = snapshot.vault_id
      WHERE vault.vault_index = ${EARN_VAULT_INDEX}
        AND snapshot.observed_at <= ${start}
        AND snapshot.context->>'publication_scope' = 'complete_product_vault'
      ORDER BY snapshot.vault_id, snapshot.observed_at DESC,
        snapshot.observed_slot DESC, snapshot.id DESC
    ),
    selected AS (
      SELECT * FROM seed
      UNION ALL
      SELECT snapshot.*
      FROM ${vaultPositionSnapshots} AS snapshot
      JOIN ${managedVaults} AS vault ON vault.id = snapshot.vault_id
      WHERE vault.vault_index = ${EARN_VAULT_INDEX}
        AND snapshot.observed_at > ${start}
        AND snapshot.observed_at <= ${end}
        AND snapshot.context->>'publication_scope' = 'complete_product_vault'
    ),
    intervals AS (
      SELECT snapshot.id, snapshot.vault_id, snapshot.observed_at,
        snapshot.context,
        LEAD(snapshot.observed_at) OVER (
          PARTITION BY snapshot.vault_id
          ORDER BY snapshot.observed_at, snapshot.observed_slot, snapshot.id
        ) AS next_at
      FROM selected AS snapshot
    ),
    -- Each selected snapshot's reserve rows are normalized once, then shared
    -- by every hour whose allocation is valid. Unknown or collateral units
    -- without a redeemable amount invalidate that hour.
    reserve_values AS (
      SELECT position.snapshot_id, position.reserve,
        CASE
          WHEN COALESCE(position.planning_metadata->>'amountSemantics',
            position.planning_metadata->>'amount_semantics') =
              'kamino_redeemable_liquidity'
            AND position.amount_raw >= 0
            THEN position.amount_raw::numeric
          WHEN COALESCE(position.planning_metadata->>'amountSemantics',
            position.planning_metadata->>'amount_semantics') =
              'kamino_obligation_collateral_deposited_amount'
            AND COALESCE(position.planning_metadata->>'redeemable_liquidity_amount_raw',
              position.planning_metadata->>'redeemable_source_liquidity_amount_raw')
              ~ '^[0-9]+$'
            THEN COALESCE(position.planning_metadata->>'redeemable_liquidity_amount_raw',
              position.planning_metadata->>'redeemable_source_liquidity_amount_raw')::numeric
          ELSE NULL
        END AS amount_raw
      FROM ${vaultPositionSnapshotPositions} AS position
      JOIN selected AS snapshot ON snapshot.id = position.snapshot_id
      WHERE position.has_value = true
    ),
    snapshot_totals AS (
      SELECT snapshot_id, SUM(amount_raw) AS reserve_raw
      FROM reserve_values
      GROUP BY snapshot_id
    ),
    current_idle AS (
      SELECT vault_id, SUM(amount_raw)::numeric AS amount_raw
      FROM ${vaultIdleTokenBalancesCurrent}
      GROUP BY vault_id
    ),
    vault_hours AS (
      SELECT hour.hour, vault.id AS vault_id, allocation.id AS snapshot_id,
        allocation.observed_at, allocation.context,
        CASE WHEN allocation.id IS NULL
          OR (hour.hour - allocation.observed_at > interval '6 hours'
            AND (COALESCE(snapshot_totals.reserve_raw, 0) > 0
              OR CASE WHEN allocation.context->>'idle_vault_liquidity_amount_raw' ~ '^[0-9]+$'
                THEN (allocation.context->>'idle_vault_liquidity_amount_raw')::numeric
                ELSE 0 END > 0))
          OR COALESCE(allocation.context->>'idle_vault_liquidity_amount_raw', '')
              !~ '^[0-9]+$'
          OR (hour.hour = ${end}::timestamptz AND
            CASE WHEN allocation.context->>'idle_vault_liquidity_amount_raw' ~ '^[0-9]+$'
              THEN (allocation.context->>'idle_vault_liquidity_amount_raw')::numeric
              ELSE NULL END IS DISTINCT FROM COALESCE(current_idle.amount_raw, 0))
          THEN true ELSE false END AS incomplete
      FROM hours AS hour
      JOIN ${managedVaults} AS vault
        ON vault.vault_index = ${EARN_VAULT_INDEX}
        AND vault.first_seen_at <= hour.hour
      LEFT JOIN intervals AS allocation
        ON allocation.vault_id = vault.id
        AND allocation.observed_at <= hour.hour
        AND (allocation.next_at IS NULL OR allocation.next_at > hour.hour)
      LEFT JOIN snapshot_totals ON snapshot_totals.snapshot_id = allocation.id
      LEFT JOIN current_idle ON current_idle.vault_id = vault.id
    ),
    bad_hours AS (
      SELECT hour.hour, bool_or(hour.incomplete OR (value.snapshot_id IS NOT NULL AND value.amount_raw IS NULL)) AS incomplete
      FROM vault_hours AS hour
      LEFT JOIN reserve_values AS value ON value.snapshot_id = hour.snapshot_id
      GROUP BY hour.hour
    ),
    reserve_hours AS (
      SELECT hour.hour, value.reserve, SUM(value.amount_raw)::text AS amount_raw
      FROM vault_hours AS hour
      JOIN reserve_values AS value ON value.snapshot_id = hour.snapshot_id
      GROUP BY hour.hour, value.reserve
    ),
    idle_hours AS (
      SELECT hour.hour,
        SUM(CASE WHEN hour.context->>'idle_vault_liquidity_amount_raw' ~ '^[0-9]+$'
          THEN (hour.context->>'idle_vault_liquidity_amount_raw')::numeric
          ELSE 0 END)::text AS idle_raw
      FROM vault_hours AS hour
      GROUP BY hour.hour
    )
    SELECT hour.hour, COALESCE(bad.incomplete, true) AS incomplete,
      reserve.reserve, reserve.amount_raw, COALESCE(idle.idle_raw, '0') AS idle_raw
    FROM hours AS hour
    LEFT JOIN bad_hours AS bad ON bad.hour = hour.hour
    LEFT JOIN reserve_hours AS reserve ON reserve.hour = hour.hour
    LEFT JOIN idle_hours AS idle ON idle.hour = hour.hour
    ORDER BY hour.hour, reserve.reserve
    LIMIT 100001
  `);
  const rows = Array.isArray(result)
    ? result
    : "rows" in result && Array.isArray(result.rows)
    ? result.rows
    : [];
  if (rows.length > 100_000) {
    throw new Error("Earn allocation aggregation exceeded the output bound.");
  }
  const snapshots = new Map<
    number,
    Omit<EarnAllocationHistory["snapshots"][number], "weights"> & {
      weights: Map<string, number>;
    }
  >();
  for (const row of rows as Record<string, unknown>[]) {
    const observedAtMs = new Date(String(row.hour)).getTime();
    const amountRaw = row.reserve === null ? 0 : safeRawAmount(row.amount_raw);
    const idleAmountRaw = safeRawAmount(row.idle_raw);
    if (!Number.isFinite(observedAtMs)) {
      throw new Error("Earn allocation aggregation returned an invalid hour.");
    }
    const snapshot = snapshots.get(observedAtMs) ?? {
      idleAmountRaw: idleAmountRaw ?? 0,
      observedAtMs,
      unsupported: row.incomplete !== false || idleAmountRaw === null,
      vaultId: "fleet",
      weights: new Map<string, number>(),
    };
    if (row.reserve !== null && typeof row.reserve === "string") {
      if (amountRaw === null) {
        snapshot.unsupported = true;
      } else if (amountRaw > 0) {
        snapshot.weights.set(row.reserve, amountRaw);
      }
    }
    snapshots.set(observedAtMs, snapshot);
  }
  return {
    currentIdleMismatch: false,
    snapshots: [...snapshots.values()],
    vaults: [{ firstSeenAtMs: start.getTime(), id: "fleet" }],
  };
}

export async function loadReserveSharePriceHistories(
  cluster: string,
  reserves: readonly string[],
  sinceMs: number,
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<Map<string, SharePricePoint[]>> {
  const histories = new Map<string, SharePricePoint[]>();
  if (reserves.length === 0) {
    return histories;
  }

  const rows = await client.db
    .select({
      observedAt: earnReserveSharePrices.observedAt,
      reserve: earnReserveSharePrices.reserve,
      sharePrice: earnReserveSharePrices.sharePrice,
    })
    .from(earnReserveSharePrices)
    .where(
      and(
        eq(earnReserveSharePrices.cluster, cluster),
        inArray(earnReserveSharePrices.reserve, [...reserves]),
        gte(earnReserveSharePrices.observedAt, new Date(sinceMs))
      )
    )
    .orderBy(asc(earnReserveSharePrices.observedAt));

  for (const row of rows) {
    const points = histories.get(row.reserve) ?? [];
    points.push({
      observedAtMs: row.observedAt.getTime(),
      sharePrice: row.sharePrice,
    });
    histories.set(row.reserve, points);
  }
  return histories;
}
