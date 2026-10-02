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

// The observed_at index can establish absence before touching the much larger
// vault snapshot history. In particular, a new recorder has no history yet.
export async function hasEarnSharePriceHistory(
  cluster: string,
  sinceMs: number,
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<boolean> {
  const rows = await client.db
    .select({ id: earnReserveSharePrices.id })
    .from(earnReserveSharePrices)
    .where(
      and(
        eq(earnReserveSharePrices.cluster, cluster),
        gte(earnReserveSharePrices.observedAt, new Date(sinceMs))
      )
    )
    .limit(1);
  return rows.length > 0;
}

// Complete vault snapshots record the fleet allocation, including concurrent
// reserves and idle capital. Sample the last snapshot as of each hour and
// aggregate in PostgreSQL; a rebalance within an hour takes effect at the next
// sample. Sparse balance deltas avoid joining every vault to every hour. The
// API never transfers a fleet-sized snapshot history.
export async function loadEarnAllocationHistory(
  sinceMs: number,
  nowMs: number,
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<EarnAllocationHistory> {
  const start = new Date(
    Math.floor(sinceMs / (60 * 60 * 1000)) * 60 * 60 * 1000
  );
  const end = new Date(nowMs);
  const query = sql`
    WITH hours AS (
      SELECT generate_series(${start}::timestamptz,
        date_trunc('hour', ${end}::timestamptz), interval '1 hour') AS hour
      UNION SELECT ${end}::timestamptz
    ),
    vaults AS (
      SELECT id, first_seen_at
      FROM ${managedVaults}
      WHERE vault_index = ${EARN_VAULT_INDEX}
        AND first_seen_at <= ${end}::timestamptz
    ),
    seed AS (
      SELECT snapshot.*
      FROM vaults AS vault
      CROSS JOIN LATERAL (
        SELECT source.id, source.vault_id, source.observed_at,
          source.observed_slot,
          source.context->>'idle_vault_liquidity_amount_raw' AS idle_text
        FROM ${vaultPositionSnapshots} AS source
        WHERE source.vault_id = vault.id
          AND source.observed_at <= ${start}
          AND source.context->>'publication_scope' = 'complete_product_vault'
        ORDER BY source.observed_at DESC, source.observed_slot DESC,
          source.id DESC
        LIMIT 1
      ) AS snapshot
    ),
    window_snapshots AS (
      SELECT snapshot.*
      FROM vaults AS vault
      CROSS JOIN LATERAL (
        SELECT source.id, source.vault_id, source.observed_at,
          source.observed_slot,
          source.context->>'idle_vault_liquidity_amount_raw' AS idle_text
        FROM ${vaultPositionSnapshots} AS source
        WHERE source.vault_id = vault.id
          AND source.observed_at > ${start}
          AND source.observed_at <= ${end}
          AND source.context->>'publication_scope' = 'complete_product_vault'
        ORDER BY source.observed_at, source.observed_slot, source.id
        OFFSET 0
      ) AS snapshot
    ),
    selected AS (
      SELECT * FROM seed
      UNION ALL
      SELECT * FROM window_snapshots
    ),
    intervals AS (
      SELECT snapshot.id, snapshot.vault_id, snapshot.observed_at,
        snapshot.observed_slot, snapshot.idle_text, vault.first_seen_at,
        LEAD(snapshot.observed_at) OVER (
          PARTITION BY snapshot.vault_id
          ORDER BY snapshot.observed_at, snapshot.observed_slot, snapshot.id
        ) AS next_at
      FROM selected AS snapshot
      JOIN vaults AS vault ON vault.id = snapshot.vault_id
    ),
    -- Each selected snapshot's reserve rows are normalized once. Unknown or
    -- collateral units without a redeemable amount invalidate its interval.
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
      SELECT snapshot_id, COALESCE(SUM(amount_raw), 0) AS reserve_raw,
        bool_or(amount_raw IS NULL) AS bad_reserve
      FROM reserve_values
      GROUP BY snapshot_id
    ),
    snapshot_state AS (
      SELECT allocation.id, allocation.vault_id, allocation.observed_at,
        allocation.observed_slot, allocation.next_at,
        GREATEST(allocation.observed_at, allocation.first_seen_at) AS active_at,
        GREATEST(allocation.next_at, allocation.first_seen_at) AS inactive_at,
        GREATEST(allocation.observed_at + interval '6 hours 1 microsecond',
          allocation.first_seen_at) AS stale_at,
        CASE WHEN allocation.idle_text ~ '^[0-9]+$'
          THEN allocation.idle_text::numeric
          ELSE NULL END AS idle_raw,
        COALESCE(total.reserve_raw, 0) AS reserve_raw,
        COALESCE(total.bad_reserve, false) OR
          COALESCE(allocation.idle_text, '')
            !~ '^[0-9]+$' AS invalid
      FROM intervals AS allocation
      LEFT JOIN snapshot_totals AS total ON total.snapshot_id = allocation.id
    ),
    current_idle AS (
      SELECT vault_id, SUM(amount_raw)::numeric AS amount_raw
      FROM ${vaultIdleTokenBalancesCurrent}
      GROUP BY vault_id
    ),
    latest_state AS (
      SELECT DISTINCT ON (vault_id) vault_id, idle_raw
      FROM snapshot_state
      ORDER BY vault_id, observed_at DESC, observed_slot DESC, id DESC
    ),
    current_mismatch AS (
      SELECT COALESCE(bool_or(
        COALESCE(latest.idle_raw, -1) IS DISTINCT FROM
          COALESCE(idle.amount_raw, 0)), false) AS invalid
      FROM vaults AS vault
      LEFT JOIN latest_state AS latest ON latest.vault_id = vault.id
      LEFT JOIN current_idle AS idle ON idle.vault_id = vault.id
    ),
    -- Each snapshot adds its balance at observation and removes it when the
    -- next snapshot for that vault takes over. Invalid/funded-stale intervals
    -- contribute a count rather than hiding missing historical exposure.
    event_rows AS (
      SELECT state.active_at AS at, value.reserve::text AS key,
        value.amount_raw AS delta
      FROM snapshot_state AS state
      JOIN reserve_values AS value ON value.snapshot_id = state.id
      WHERE value.amount_raw > 0
      UNION ALL
      SELECT state.inactive_at, value.reserve::text, -value.amount_raw
      FROM snapshot_state AS state
      JOIN reserve_values AS value ON value.snapshot_id = state.id
      WHERE state.next_at IS NOT NULL AND value.amount_raw > 0
      UNION ALL
      SELECT state.active_at, '__idle__', state.idle_raw
      FROM snapshot_state AS state WHERE state.idle_raw > 0
      UNION ALL
      SELECT state.inactive_at, '__idle__', -state.idle_raw
      FROM snapshot_state AS state
      WHERE state.next_at IS NOT NULL AND state.idle_raw > 0
      UNION ALL
      SELECT state.active_at, '__covered__', 1::numeric
      FROM snapshot_state AS state
      UNION ALL
      SELECT state.inactive_at, '__covered__', -1::numeric
      FROM snapshot_state AS state WHERE state.next_at IS NOT NULL
      UNION ALL
      SELECT vault.first_seen_at, '__expected__', 1::numeric
      FROM vaults AS vault
      UNION ALL
      SELECT state.active_at, '__invalid__', 1::numeric
      FROM snapshot_state AS state WHERE state.invalid
      UNION ALL
      SELECT state.inactive_at, '__invalid__', -1::numeric
      FROM snapshot_state AS state
      WHERE state.invalid AND state.next_at IS NOT NULL
      UNION ALL
      SELECT state.stale_at, '__invalid__', 1::numeric
      FROM snapshot_state AS state
      WHERE (state.reserve_raw > 0 OR state.idle_raw > 0)
        AND (state.next_at IS NULL OR
          state.next_at > state.observed_at + interval '6 hours 1 microsecond')
      UNION ALL
      SELECT state.inactive_at, '__invalid__', -1::numeric
      FROM snapshot_state AS state
      WHERE (state.reserve_raw > 0 OR state.idle_raw > 0)
        AND state.next_at > state.observed_at + interval '6 hours 1 microsecond'
    ),
    event_deltas AS (
      SELECT at, key, SUM(delta) AS delta
      FROM event_rows
      WHERE at <= ${end}::timestamptz
      GROUP BY at, key
    ),
    keys AS (
      SELECT DISTINCT reserve::text AS key
      FROM reserve_values WHERE amount_raw > 0
      UNION ALL SELECT '__idle__'
      UNION ALL SELECT '__covered__'
      UNION ALL SELECT '__expected__'
      UNION ALL SELECT '__invalid__'
    ),
    sweep_rows AS (
      SELECT at, key, delta, 0 AS kind FROM event_deltas
      UNION ALL
      SELECT hour.hour AS at, key.key, 0::numeric AS delta, 1 AS kind
      FROM hours AS hour CROSS JOIN keys AS key
    ),
    sampled AS (
      SELECT at AS hour, key, kind,
        SUM(delta) OVER (PARTITION BY key ORDER BY at, kind
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS amount_raw
      FROM sweep_rows
    ),
    hour_totals AS (
      SELECT hour,
        MAX(amount_raw) FILTER (WHERE key = '__idle__') AS idle_raw,
        MAX(amount_raw) FILTER (WHERE key = '__covered__') AS covered,
        MAX(amount_raw) FILTER (WHERE key = '__expected__') AS expected,
        MAX(amount_raw) FILTER (WHERE key = '__invalid__') AS invalid
      FROM sampled WHERE kind = 1
      GROUP BY hour
    ),
    reserve_hours AS (
      SELECT hour, key AS reserve, amount_raw::text AS amount_raw
      FROM sampled
      WHERE kind = 1 AND key NOT IN (
        '__idle__', '__covered__', '__expected__', '__invalid__')
        AND amount_raw > 0
    )
    SELECT hour.hour,
      (COALESCE(total.expected, 0) <= 0
        OR COALESCE(total.covered, 0) <> COALESCE(total.expected, 0)
        OR COALESCE(total.invalid, 0) > 0
        OR (hour.hour = ${end}::timestamptz AND mismatch.invalid)) AS incomplete,
      reserve.reserve, reserve.amount_raw,
      COALESCE(total.idle_raw, 0)::text AS idle_raw
    FROM hours AS hour
    LEFT JOIN hour_totals AS total ON total.hour = hour.hour
    LEFT JOIN reserve_hours AS reserve ON reserve.hour = hour.hour
    CROSS JOIN current_mismatch AS mismatch
    ORDER BY hour.hour, reserve.reserve
    LIMIT 100001
  `;
  // Neon HTTP has no interactive transactions, but batch runs these three
  // statements in one transaction. The local postgres-js adapter uses an
  // interactive transaction instead. The database enforces the time limit;
  // abandoning a client promise would leave the expensive query running.
  const db = client.db;
  const result =
    typeof db.batch === "function"
      ? (
          await db.batch([
            db.execute(sql`SET TRANSACTION READ ONLY`),
            db.execute(sql`SET LOCAL statement_timeout = '10s'`),
            db.execute(query),
          ])
        )[2]
      : await db.transaction(async (tx) => {
          await tx.execute(sql`SET TRANSACTION READ ONLY`);
          await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
          return tx.execute(query);
        });
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
