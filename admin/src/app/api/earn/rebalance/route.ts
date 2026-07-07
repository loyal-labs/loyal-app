import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";

import {
  getActiveReserveRoutes,
  getRecentRebalanceDecisions,
} from "../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [apyData, routes, decisions] = await Promise.all([
    getSafeReserveApyMonitorData(),
    getActiveReserveRoutes(),
    getRecentRebalanceDecisions(),
  ]);

  return NextResponse.json(
    {
      apyData,
      decisions: decisions.map((decision) => ({
        ...decision,
        amountRaw: decision.amountRaw?.toString() ?? null,
        confirmedSlot: decision.confirmedSlot?.toString() ?? null,
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
