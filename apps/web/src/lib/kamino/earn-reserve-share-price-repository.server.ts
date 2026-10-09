import "server-only";

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import {
  earnFleetAllocationsHourly,
  earnReserveSharePrices,
  getYieldOptimizationClient,
  type YieldOptimizationClient,
} from "@/lib/yield-optimization/yield-neon-client.server";

import { earnAllocationHistoryFromSamples } from "./earn-fleet-allocation.shared";
import type {
  EarnAllocationHistory,
  SharePricePoint,
} from "./earn-realized-apy.shared";

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

// A sample stays in force until the next one, for at most six hours, so the
// allocation at the start of the window can come from just before it.
const HOUR_MS = 60 * 60 * 1000;
const ALLOCATION_SEED_LOOKBACK_MS = 6 * HOUR_MS;

// Hourly fleet allocation samples written by the Go observer. Reading
// them is bounded by the window length (one row per hour), not by fleet size
// or snapshot history.
export async function loadEarnAllocationHistory(
  cluster: string,
  sinceMs: number,
  nowMs: number,
  client: YieldOptimizationClient = getYieldOptimizationClient()
): Promise<EarnAllocationHistory> {
  const rows = await client.db
    .select({
      excludedAmountRaw: earnFleetAllocationsHourly.excludedAmountRaw,
      idleAmountRaw: earnFleetAllocationsHourly.idleAmountRaw,
      observedAt: earnFleetAllocationsHourly.observedAt,
      reserveAmounts: earnFleetAllocationsHourly.reserveAmounts,
    })
    .from(earnFleetAllocationsHourly)
    .where(
      and(
        eq(earnFleetAllocationsHourly.cluster, cluster),
        // Range on the primary key; observed_at lies inside its hour.
        gte(
          earnFleetAllocationsHourly.observedHour,
          new Date(
            Math.floor((sinceMs - ALLOCATION_SEED_LOOKBACK_MS) / HOUR_MS) *
              HOUR_MS
          )
        ),
        lte(earnFleetAllocationsHourly.observedHour, new Date(nowMs)),
        lte(earnFleetAllocationsHourly.observedAt, new Date(nowMs))
      )
    )
    .orderBy(asc(earnFleetAllocationsHourly.observedHour));

  return earnAllocationHistoryFromSamples(
    rows.map((row) => ({ ...row, observedAtMs: row.observedAt.getTime() })),
    sinceMs
  );
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
