import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

import {
  getActiveReserveRoutes,
  getAutodepositTimeSeries,
  getEarnVaultRebalanceFrequency,
  getExecutedEarnRebalanceHistory,
  getLast30DaysRebalanceSeries,
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
    last30DaysRebalances,
    autodeposit,
  ] = await Promise.all([
    getSafeReserveApyMonitorData(),
    getActiveReserveRoutes(),
    getRecentRebalanceDecisions(),
    getRebalanceActivity(),
    getLast30DaysRebalanceSeries(),
    getAutodepositTimeSeries(),
  ]);

  return {
    activity: activity.map((point) => ({
      ...point,
      maxSwapFeeLamports: point.maxSwapFeeLamports.toString(),
      swapFeeLamports: point.swapFeeLamports.toString(),
    })),
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
    last30DaysRebalances,
    routes: routes.map((route) => ({
      ...route,
      activeAumRaw: route.activeAumRaw.toString(),
    })),
  };
}

async function loadExecutedRebalances() {
  try {
    const history = await getExecutedEarnRebalanceHistory();

    return {
      ...history,
      status: "available" as const,
      chartPoints: history.chartPoints.map((execution) => ({
        ...execution,
        amountRaw: execution.amountRaw.toString(),
        confirmedSlot: execution.confirmedSlot.toString(),
        currentDepositRaw: execution.currentDepositRaw.toString(),
        swapFeeLamports: execution.swapFeeLamports.toString(),
      })),
      details: history.details.map((execution) => ({
        ...execution,
        amountRaw: execution.amountRaw.toString(),
        confirmedSlot: execution.confirmedSlot.toString(),
        currentDepositRaw: execution.currentDepositRaw.toString(),
        swapFeeLamports: execution.swapFeeLamports.toString(),
      })),
      summaries: history.summaries.map((summary) => ({
        ...summary,
        swapFeeLamports: summary.swapFeeLamports.toString(),
      })),
    };
  } catch (error) {
    console.error("Executed Earn rebalance history query failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown database error",
      errorName: error instanceof Error ? error.name : "Error",
    });

    return {
      chartPoints: [],
      details: [],
      generatedAt: new Date().toISOString(),
      status: "unavailable" as const,
      summaries: [],
    };
  }
}

async function loadVaultRebalanceFrequency() {
  try {
    const frequency = await getEarnVaultRebalanceFrequency();

    return {
      ...frequency,
      status: "available" as const,
      chartPoints: frequency.chartPoints.map((vault) => ({
        ...vault,
        currentDepositRaw: vault.currentDepositRaw.toString(),
      })),
      details: frequency.details.map((vault) => ({
        ...vault,
        currentDepositRaw: vault.currentDepositRaw.toString(),
      })),
    };
  } catch (error) {
    console.error("Earn vault rebalance frequency query failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown database error",
      errorName: error instanceof Error ? error.name : "Error",
    });

    return {
      generatedAt: new Date().toISOString(),
      status: "unavailable" as const,
      chartPoints: [],
      details: [],
      summaries: [],
      vaultCount: 0,
    };
  }
}

const getCachedRebalanceMonitorData = unstable_cache(
  loadRebalanceMonitorData,
  ["earn-rebalance-monitor"],
  { revalidate: DATA_CACHE_TTL_SECONDS }
);

export async function GET() {
  const [monitorData, executedRebalances, vaultRebalanceFrequency] =
    await Promise.all([
      getCachedRebalanceMonitorData(),
      loadExecutedRebalances(),
      loadVaultRebalanceFrequency(),
    ]);

  return NextResponse.json(
    { ...monitorData, executedRebalances, vaultRebalanceFrequency },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}
