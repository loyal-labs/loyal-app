import { NextResponse } from "next/server";
import { rejectForeignParams } from "@/features/vault/server/config";
import { getWorkerObservation } from "@/features/vault/server/worker-observation";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const foreign = rejectForeignParams(new URL(request.url).searchParams, []);
  if (foreign) return NextResponse.json({ unavailable: true, reason: foreign }, { status: 400, headers });
  const read = await getWorkerObservation();
  return read.ok ? NextResponse.json(read.observation, { headers }) :
    NextResponse.json({ unavailable: true, reason: read.reason }, { status: 503, headers });
}
