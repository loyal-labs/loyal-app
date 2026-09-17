import { NextResponse } from "next/server";
import { rejectForeignParams } from "@/features/vault/server/config";
import { getTokenHoldings } from "@/features/vault/server/token-holdings";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const foreign = rejectForeignParams(new URL(request.url).searchParams, []);
  const headers = { "cache-control": "no-store" };
  if (foreign) return NextResponse.json({ unavailable: true, reason: foreign }, { status: 400, headers });
  const read = await getTokenHoldings();
  return read.ok ? NextResponse.json(read.observation, { headers }) : NextResponse.json({ unavailable: true, reason: read.reason }, { status: 503, headers });
}
