import "server-only";

import { sql } from "drizzle-orm";

import {
  earnFleetAllocationsHourly,
  getYieldOptimizationClient,
  managedVaults,
  vaultIdleTokenBalancesCurrent,
  vaultPositionSnapshotPositions,
  vaultPositionSnapshots,
  type YieldOptimizationClient,
} from "@/lib/yield-optimization/yield-neon-client.server";

import type {
  EarnFleetAllocationSample,
  EarnFleetVaultPosition,
  EarnFleetVaultState,
} from "./earn-fleet-allocation.shared";

// Loyal Earn positions live in vault 1; vault 0 is agent-managed.
const EARN_VAULT_INDEX = 1;

function executeRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function jsonArray<T>(value: unknown): T[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

// One row per active Earn vault with its latest complete snapshot, that
// snapshot's funded positions and the vault's current idle balances. Inactive
// vaults are left out: their complete snapshots are missing or stale, so
// their capital cannot be placed. Each vault costs one top-1 probe of the
// complete-snapshot history index, so the read stays bounded by fleet size
// and never scans snapshot history.
export async function loadEarnFleetVaultStates(
  now: Date,
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<EarnFleetVaultState[]> {
  const asOf = now.toISOString();
  const query = sql`
    SELECT
      vault.id::text AS vault_id,
      snapshot.id::text AS snapshot_id,
      floor(extract(epoch FROM snapshot.observed_at) * 1000)::bigint::text
        AS observed_at_ms,
      snapshot.observed_slot::text AS observed_slot,
      snapshot.context_idle_raw,
      COALESCE((
        SELECT json_agg(json_build_object(
          'reserve', position.reserve,
          'market', position.market,
          'liquidityMint', position.liquidity_mint,
          'amountRaw', position.amount_raw::text,
          'amountSemantics', COALESCE(
            position.planning_metadata->>'amountSemantics',
            position.planning_metadata->>'amount_semantics'),
          'redeemableLiquidityRaw', COALESCE(
            position.planning_metadata->>'redeemable_liquidity_amount_raw',
            position.planning_metadata->>'redeemable_source_liquidity_amount_raw')
        ))
        FROM ${vaultPositionSnapshotPositions} AS position
        WHERE position.snapshot_id = snapshot.id
          AND position.has_value = true
      ), '[]'::json) AS positions,
      COALESCE((
        SELECT json_agg(json_build_object(
          'amountRaw', idle.amount_raw::text,
          'observedSlot', idle.observed_slot::text
        ))
        FROM ${vaultIdleTokenBalancesCurrent} AS idle
        WHERE idle.vault_id = vault.id
      ), '[]'::json) AS current_idle
    FROM ${managedVaults} AS vault
    LEFT JOIN LATERAL (
      SELECT source.id, source.observed_at, source.observed_slot,
        source.context->>'idle_vault_liquidity_amount_raw' AS context_idle_raw
      FROM ${vaultPositionSnapshots} AS source
      WHERE source.vault_id = vault.id
        AND source.observed_at <= ${asOf}::timestamptz
        AND source.context->>'publication_scope' = 'complete_product_vault'
      ORDER BY source.observed_at DESC, source.observed_slot DESC,
        source.id DESC
      LIMIT 1
    ) AS snapshot ON true
    WHERE vault.vault_index = ${EARN_VAULT_INDEX}
      AND vault.active = true
      AND vault.first_seen_at <= ${asOf}::timestamptz
    ORDER BY vault.id
  `;
  // Neon HTTP has no interactive transactions, but batch runs these three
  // statements in one transaction. The local postgres-js adapter uses an
  // interactive transaction instead. The database enforces the time limit:
  // the read takes under 100 ms on cached pages but several seconds when an
  // hourly run finds them cold, and this job has no caller waiting.
  const db = client.db;
  const result =
    typeof db.batch === "function"
      ? (
          await db.batch([
            db.execute(sql`SET TRANSACTION READ ONLY`),
            db.execute(sql`SET LOCAL statement_timeout = '30s'`),
            db.execute(query),
          ])
        )[2]
      : await db.transaction(async (tx) => {
          await tx.execute(sql`SET TRANSACTION READ ONLY`);
          await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
          return tx.execute(query);
        });

  return executeRows(result).map((row) => ({
    currentIdle: jsonArray<EarnFleetVaultState["currentIdle"][number]>(
      row.current_idle
    ),
    snapshot:
      row.snapshot_id === null || row.snapshot_id === undefined
        ? null
        : {
            contextIdleRaw:
              typeof row.context_idle_raw === "string"
                ? row.context_idle_raw
                : null,
            observedAtMs: Number(row.observed_at_ms),
            observedSlot: String(row.observed_slot),
            positions: jsonArray<EarnFleetVaultPosition>(row.positions),
          },
    vaultId: String(row.vault_id),
  }));
}

export async function upsertEarnFleetAllocation(
  cluster: string,
  sample: EarnFleetAllocationSample,
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<void> {
  await client.db
    .insert(earnFleetAllocationsHourly)
    .values({ cluster, ...sample })
    .onConflictDoUpdate({
      target: [
        earnFleetAllocationsHourly.cluster,
        earnFleetAllocationsHourly.observedHour,
      ],
      set: {
        calcVersion: sql`excluded.calc_version`,
        excludedAmountRaw: sql`excluded.excluded_amount_raw`,
        idleAmountRaw: sql`excluded.idle_amount_raw`,
        newestSourceAt: sql`excluded.newest_source_at`,
        observedAt: sql`excluded.observed_at`,
        oldestSourceAt: sql`excluded.oldest_source_at`,
        reserveAmounts: sql`excluded.reserve_amounts`,
        vaultsIncluded: sql`excluded.vaults_included`,
        vaultsInvalid: sql`excluded.vaults_invalid`,
        vaultsMissing: sql`excluded.vaults_missing`,
        vaultsStale: sql`excluded.vaults_stale`,
        vaultsTotal: sql`excluded.vaults_total`,
      },
      // A delayed overlapping cron must not replace a newer sample.
      setWhere: sql`excluded.observed_at >= ${earnFleetAllocationsHourly.observedAt}`,
    });
}
