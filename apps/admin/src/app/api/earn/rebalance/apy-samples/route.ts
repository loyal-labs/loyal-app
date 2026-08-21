import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getSafeReserveApyMonitorData(), {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
