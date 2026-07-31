import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

import {
  getActiveReserveRoutes,
  getAutodepositTimeSeries,
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
    previousMonthRebalances,
    autodeposit,
  ] = await Promise.all([
    getSafeReserveApyMonitorData(),
    getActiveReserveRoutes(),
    getRecentRebalanceDecisions(),
    getRebalanceActivity(),
    getPreviousMonthRebalanceSeries(),
    getAutodepositTimeSeries(),
  ]);

  return {
    activity,
    apyData,
    autodeposit: autodeposit.map((range) => ({
      bucketHours: range.bucketHours,
      key: range.key,
      points: range.points.map((point) => ({
        accountNotFound: point.accountNotFound,
        bucketStartedAt: point.bucketStartedAt,
        confirmationOrTimeout: point.confirmationOrTimeout,
        insufficientRent: point.insufficientRent,
        missingTokenDelegate: point.missingTokenDelegate,
        noLinkedError: point.noLinkedError,
        otherPrePull: point.otherPrePull,
        postPullKaminoTopUp: point.postPullKaminoTopUp,
      })),
    })),
    decisions: decisions.map((decision) => ({
      ...decision,
      amountRaw: decision.amountRaw?.toString() ?? null,
      confirmedSlot: decision.confirmedSlot?.toString() ?? null,
    })),
    previousMonthRebalances,
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
