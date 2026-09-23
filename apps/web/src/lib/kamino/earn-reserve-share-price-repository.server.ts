import "server-only";

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";

import {
  earnReserveSharePrices,
  getYieldOptimizationClient,
  userYieldPositions,
  type YieldOptimizationClient,
} from "@/lib/yield-optimization/yield-neon-client.server";

import type { SharePricePoint } from "./earn-realized-apy.shared";

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
    });
}

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
    .where(eq(userYieldPositions.status, "active"))
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
