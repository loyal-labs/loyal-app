import { NextResponse } from "next/server";

import { rejectForeignParams } from "@/features/vault/server/config";
import { getPositionObservation } from "@/features/vault/server/position";

export const dynamic = "force-dynamic";

/** GET /api/position?wallet=<address> — wallet-scoped read-only position. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const foreign = rejectForeignParams(url.searchParams, ["wallet"]);
  if (foreign) {
    return NextResponse.json({ unavailable: true, reason: foreign, kind: "invalid-input" }, { status: 400 });
  }
  const read = await getPositionObservation(url.searchParams.get("wallet"));
  if (!read.ok) {
    const status = read.unavailable.kind === "invalid-input" ? 400 : read.unavailable.kind === "account-missing" ? 404 : 503;
    return NextResponse.json(read.unavailable, { status, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(read.observation, { headers: { "cache-control": "no-store" } });
}
