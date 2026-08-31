import { NextResponse } from "next/server";

import { getSafeReserveApyMonitorData } from "@/lib/kamino/timescale-reserve-client.server";
import { requireAdminSession } from "@/lib/require-admin-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await requireAdminSession();

  return NextResponse.json(await getSafeReserveApyMonitorData(), {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
