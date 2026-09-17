import { NextResponse } from "next/server";

import { rejectForeignParams } from "@/features/vault/server/config";
import { getVaultObservation } from "@/features/vault/server/vault-observation";

export const dynamic = "force-dynamic";

/** GET /api/vault — vault-wide read-only observation. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const foreign = rejectForeignParams(url.searchParams, []);
  if (foreign) {
    return NextResponse.json({ unavailable: true, reason: foreign, kind: "invalid-input" }, { status: 400 });
  }
  const read = await getVaultObservation();
  if (!read.ok) {
    return NextResponse.json(
      {
        unavailable: true,
        reason: read.reason,
        kind: read.kind,
      },
      // A required account being absent is a different fact from an RPC outage.
      { status: read.kind === "account-missing" ? 404 : 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(read.observation, { headers: { "cache-control": "no-store" } });
}
