import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";

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

export async function GET() {
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

  return NextResponse.json(
    {
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
    },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
