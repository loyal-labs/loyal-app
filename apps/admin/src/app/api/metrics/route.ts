import { NextResponse } from "next/server";

import { getEarnRebalanceLatencyData } from "../../(admin)/metrics/earn-rebalance-latency-data";
import { getMetricsData } from "../../(admin)/metrics/metrics-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const section = new URL(request.url).searchParams.get("section");

  if (section === "latency") {
    return NextResponse.json(await getEarnRebalanceLatencyData(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (section === "dashboard") {
    return NextResponse.json(await getMetricsData(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  return NextResponse.json(
    { error: "section must be latency or dashboard" },
    { status: 400, headers: { "Cache-Control": "private, no-store" } }
  );
}
