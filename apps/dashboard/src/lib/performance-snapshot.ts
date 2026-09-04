import "server-only";

import { loyalStatsSnapshots } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database.server";

const USDC_DECIMALS = 6;
const CURRENT_SNAPSHOT_KEY = "current";
const STATS_MAX_AGE_MS = 5 * 60 * 1000;

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const dateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatDateLabel(value: string) {
  return dateLabelFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateRangeLabel(start: string, end: string) {
  return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
}

function formatUsdcRaw(raw: bigint) {
  const amount = Number(raw) / 10 ** USDC_DECIMALS;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amount);
}

function rawToUsdc(raw: bigint) {
  return Number(raw) / 10 ** USDC_DECIMALS;
}

function formatUserCount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export async function getPublicPerformanceSnapshot() {
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

  return {
    updatedAt: `${dateTimeFormatter.format(snapshot.refreshedAt)} UTC`,
    metrics: [
      {
        label: "Earn AUM",
        value: formatUsdcRaw(snapshot.totalAumRaw),
        detail: "Current normalized Earn AUM.",
        tooltip:
          "Cumulative value deposited into our active Earn routing policies.",
      },
      {
        label: "Optimization Volume",
        value: formatUsdcRaw(snapshot.totalOptimizedVolumeRaw),
        detail: "Cumulative confirmed moved volume.",
        tooltip:
          "Total USDC reallocated by confirmed Earn optimizations. This measures routing throughput across reserves, so the same deposited dollar can add to volume again when it is moved by a later optimization.",
      },
      {
        label: "Total Users",
        value: formatUserCount(snapshot.totalUsers),
        detail: "Registered Loyal users.",
        tooltip: "Total wallet-based user accounts registered with Loyal.",
      },
    ],
    earnAumSeries: snapshot.earnAumSeries.map((point) => ({
      label: formatDateLabel(point.weekStart),
      periodLabel: formatDateRangeLabel(point.weekStart, point.weekEnd),
      value: rawToUsdc(BigInt(point.aumRaw)),
      valueRaw: point.aumRaw,
    })),
  };
}
