import { unstable_cache } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";
import {
  buildRebalancePerformancePoints,
  parseRebalancePerformanceMint,
  summarizeRebalancePerformance,
} from "@/lib/earn/rebalance-performance.shared";
import { getEarnStablecoinSymbol } from "@/lib/earn/stablecoin-monitor.shared";
import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";

import {
  getActiveReserveRoutes,
  getEarnRebalancePerformanceYieldData,
} from "../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BUCKET_DURATION_MS = 5 * 60 * 1000;

function logUnavailableSource(source: string, error: unknown) {
  console.error("Earn rebalance performance source unavailable", {
    errorMessage:
      error instanceof Error ? error.message : "Unknown database error",
    errorName: error instanceof Error ? error.name : "Error",
    source,
  });
}

async function loadRebalancePerformance(liquidityMint: string) {
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - WINDOW_MS);
  const [marketResult, yieldResult, routesResult] = await Promise.allSettled([
    getSafeReserveApyMonitorData(),
    getEarnRebalancePerformanceYieldData({
      endedAt,
      liquidityMint,
      startedAt,
    }),
    getActiveReserveRoutes(),
  ]);

  if (marketResult.status === "rejected") {
    logUnavailableSource("kamino_timescale", marketResult.reason);
  }
  if (yieldResult.status === "rejected") {
    logUnavailableSource("yield_neon", yieldResult.reason);
  }
  if (routesResult.status === "rejected") {
    logUnavailableSource("yield_current_routes", routesResult.reason);
  }

  const selectedSeries =
    marketResult.status === "fulfilled"
      ? marketResult.value.series.filter(
          (series) => series.liquidityMint === liquidityMint
        )
      : [];
  const apyRows =
    marketResult.status === "fulfilled"
      ? marketResult.value.chartPoints.flatMap((point) =>
          selectedSeries.map((series) => ({
            bucketStartedAt: point.observedAt,
            reserve: series.reserve,
            supplyApyPercent:
              typeof point[series.key] === "number"
                ? (point[series.key] as number)
                : null,
          }))
        )
      : [];
  const points = buildRebalancePerformancePoints({
    apyRows,
    bucketDurationMs: BUCKET_DURATION_MS,
    confirmedRebalances:
      yieldResult.status === "fulfilled"
        ? yieldResult.value.confirmedRebalances
        : [],
    fleetAumRows:
      yieldResult.status === "fulfilled" ? yieldResult.value.fleetAumRows : [],
  });

  return {
    bucketMinutes: BUCKET_DURATION_MS / 60_000,
    current: {
      routes:
        routesResult.status === "fulfilled"
          ? routesResult.value
              .filter((route) => route.liquidityMint === liquidityMint)
              .map((route) => ({
                ...route,
                activeAumRaw: route.activeAumRaw.toString(),
              }))
          : [],
      statuses:
        marketResult.status === "fulfilled"
          ? marketResult.value.statuses.filter(
              (status) => status.liquidityMint === liquidityMint
            )
          : [],
    },
    generatedAt: endedAt.toISOString(),
    liquidityMint,
    opportunities:
      yieldResult.status === "fulfilled"
        ? yieldResult.value.opportunitySummary
        : null,
    points,
    sources: {
      fleet: yieldResult.status === "fulfilled" ? "available" : "unavailable",
      market: marketResult.status === "fulfilled" ? "available" : "unavailable",
    },
    summary: summarizeRebalancePerformance(points),
    symbol: getEarnStablecoinSymbol(liquidityMint) ?? "Unknown",
    window: {
      endedAt: endedAt.toISOString(),
      startedAt: startedAt.toISOString(),
    },
  };
}

const getCachedRebalancePerformance = unstable_cache(
  loadRebalancePerformance,
  ["earn-rebalance-performance"],
  { revalidate: DATA_CACHE_TTL_SECONDS }
);

export async function GET(request: NextRequest) {
  const liquidityMint = parseRebalancePerformanceMint(
    request.nextUrl.searchParams.get("mint")
  );
  if (!liquidityMint) {
    return NextResponse.json(
      { error: "A canonical Earn stablecoin mint is required." },
      { status: 400 }
    );
  }

  return NextResponse.json(await getCachedRebalancePerformance(liquidityMint), {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
