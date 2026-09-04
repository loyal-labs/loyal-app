import "server-only";

import { loyalStatsSnapshots } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

const USDC_DECIMALS = 6;
const CURRENT_SNAPSHOT_KEY = "current";
const STATS_MAX_AGE_MS = 5 * 60 * 1000;

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
  refreshedAt: string;
  totalUsers: number;
};

const dateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function rawToUsdc(raw: bigint): number {
  return Number(raw) / 10 ** USDC_DECIMALS;
}

function formatDateLabel(value: string): string {
  return dateLabelFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

async function loadEarnPublicStats(): Promise<EarnPublicStats> {
  const rows = await getDatabase()
    .select({
      earnAumSeries: loyalStatsSnapshots.earnAumSeries,
      refreshedAt: loyalStatsSnapshots.refreshedAt,
      totalAumRaw: loyalStatsSnapshots.totalAumRaw,
      totalOptimizedVolumeRaw: loyalStatsSnapshots.totalOptimizedVolumeRaw,
      totalUsers: loyalStatsSnapshots.totalUsers,
    })
    .from(loyalStatsSnapshots)
    .where(eq(loyalStatsSnapshots.snapshotKey, CURRENT_SNAPSHOT_KEY))
    .limit(1);

  const snapshot = rows[0];
  if (!snapshot) {
    throw new Error("Loyal stats snapshot is unavailable");
  }

  const ageMs = Math.max(0, Date.now() - snapshot.refreshedAt.getTime());
  if (ageMs > STATS_MAX_AGE_MS) {
    throw new Error("Loyal stats snapshot is stale");
  }

  const seriesRaw = snapshot.earnAumSeries.map((point) => ({
    endLabel: formatDateLabel(point.weekEnd),
    label: formatDateLabel(point.weekStart),
    raw: BigInt(point.aumRaw),
  }));
  const lastPoint = seriesRaw.at(-1);
  const priorPoint = seriesRaw.at(-2);

  return {
    aumUsd: rawToUsdc(snapshot.totalAumRaw),
    aumDeltaVsPriorWeekUsd:
      lastPoint && priorPoint
        ? rawToUsdc(lastPoint.raw - priorPoint.raw)
        : null,
    aumSeries: seriesRaw.map((point) => ({
      label: point.label,
      periodLabel: `${point.label} - ${point.endLabel}`,
      value: rawToUsdc(point.raw),
    })),
    optimizationVolumeUsd: rawToUsdc(snapshot.totalOptimizedVolumeRaw),
    refreshedAt: snapshot.refreshedAt.toISOString(),
    totalUsers: snapshot.totalUsers,
  };
}

// The route-level CDN cache handles response caching. This loader deliberately
// performs only a single-row app database read so cold functions never rebuild
// Yield aggregates.
export async function getEarnPublicStats(): Promise<EarnPublicStats> {
  return loadEarnPublicStats();
}
