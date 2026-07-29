import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";

import {
  getActiveReserveRoutes,
  getOptimizationVolumeSeries,
  getRebalanceActivity,
  getRecentRebalanceDecisions,
} from "../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [apyData, routes, decisions, activity, optimizationVolume] =
    await Promise.all([
      getSafeReserveApyMonitorData(),
      getActiveReserveRoutes(),
      getRecentRebalanceDecisions(),
      getRebalanceActivity(),
      getOptimizationVolumeSeries(),
    ]);

  return NextResponse.json(
    {
      activity,
      apyData,
      decisions: decisions.map((decision) => ({
        ...decision,
        amountRaw: decision.amountRaw?.toString() ?? null,
        confirmedSlot: decision.confirmedSlot?.toString() ?? null,
      })),
      optimizationVolume: optimizationVolume.map((point) => ({
        ...point,
        cumulativeAmountRaw: point.cumulativeAmountRaw.toString(),
        dailyAmountRaw: point.dailyAmountRaw.toString(),
      })),
      routes: routes.map((route) => ({
        ...route,
        activeAumRaw: route.activeAumRaw.toString(),
      })),
    },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
