import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

import {
  getActiveReserveRoutes,
  getAutodepositTimeSeries,
  getOptimizationVolumeSeries,
  getPreviousMonthRebalanceSeries,
  getRebalanceActivity,
  getRecentRebalanceDecisions,
} from "../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadRebalanceMonitorData() {
  const [
    apyData,
    routes,
    decisions,
    activity,
    autodeposit,
    previousMonthRebalances,
    optimizationVolume,
  ] = await Promise.all([
    getSafeReserveApyMonitorData(),
    getActiveReserveRoutes(),
    getRecentRebalanceDecisions(),
    getRebalanceActivity(),
    getAutodepositTimeSeries(),
    getPreviousMonthRebalanceSeries(),
    getOptimizationVolumeSeries(),
  ]);

  return {
    activity,
    apyData,
    autodeposit: autodeposit.map((range) => ({
      ...range,
      points: range.points.map((point) => ({
        ...point,
        depositedAmountRaw: point.depositedAmountRaw.toString(),
      })),
    })),
    decisions: decisions.map((decision) => ({
      ...decision,
      amountRaw: decision.amountRaw?.toString() ?? null,
      confirmedSlot: decision.confirmedSlot?.toString() ?? null,
    })),
    previousMonthRebalances,
    optimizationVolume: optimizationVolume.map((point) => ({
      ...point,
      cumulativeAmountRaw: point.cumulativeAmountRaw.toString(),
      dailyAmountRaw: point.dailyAmountRaw.toString(),
    })),
    routes: routes.map((route) => ({
      ...route,
      activeAumRaw: route.activeAumRaw.toString(),
    })),
  };
}

const getCachedRebalanceMonitorData = unstable_cache(
  loadRebalanceMonitorData,
  ["earn-rebalance-monitor"],
  { revalidate: DATA_CACHE_TTL_SECONDS }
);

export async function GET() {
  return NextResponse.json(await getCachedRebalanceMonitorData(), {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
