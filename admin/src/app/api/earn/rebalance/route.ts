import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

import {
  getActiveReserveRoutes,
  getAutodepositTimeSeries,
  getExecutedEarnRebalanceHistory,
  getLast30DaysRebalanceSeries,
  getRebalanceActivity,
  getRecentRebalanceDecisions,
} from "../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadRebalanceMonitorData() {
  const executedRebalancesPromise = getExecutedEarnRebalanceHistory()
    .then((history) => ({ ...history, status: "available" as const }))
    .catch((error) => {
      console.error("Executed Earn rebalance history query failed", {
        errorMessage:
          error instanceof Error ? error.message : "Unknown database error",
        errorName: error instanceof Error ? error.name : "Error",
      });

      return {
        executions: [],
        generatedAt: new Date().toISOString(),
        status: "unavailable" as const,
        userCount: 0,
      };
    });
  const [
    apyData,
    routes,
    decisions,
    activity,
    last30DaysRebalances,
    autodeposit,
    executedRebalances,
  ] = await Promise.all([
    getSafeReserveApyMonitorData(),
    getActiveReserveRoutes(),
    getRecentRebalanceDecisions(),
    getRebalanceActivity(),
    getLast30DaysRebalanceSeries(),
    getAutodepositTimeSeries(),
    executedRebalancesPromise,
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
    executedRebalances: {
      ...executedRebalances,
      executions: executedRebalances.executions.map((execution) => ({
        ...execution,
        amountRaw: execution.amountRaw.toString(),
        confirmedSlot: execution.confirmedSlot.toString(),
        currentDepositRaw: execution.currentDepositRaw.toString(),
      })),
    },
    last30DaysRebalances,
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
