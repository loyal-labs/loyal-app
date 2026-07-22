import { NextResponse } from "next/server";

import { reconcileEarnCleanupGhosts } from "@/lib/yield-optimization/earn-cleanup-reconcile.server";

import { validateCronAuthHeader } from "../_shared/auth";

// Finalizes ghost Earn positions (recorded full withdrawal, chain-proven
// exit, row still `active`) through the canonical cleanup writer. Every
// finalize is an operational signal that a cleanup or its confirm was lost.
// `?dryRun=1` scans and reports without writing; `?limit=N` overrides the
// per-run candidate cap for manual backlog drains.
export const maxDuration = 300;

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const limitParam = Number(params.get("limit"));
  const limit =
    Number.isSafeInteger(limitParam) && limitParam > 0 ? limitParam : undefined;
  try {
    const summary = await reconcileEarnCleanupGhosts({ dryRun, limit });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[cron/earn-cleanup-reconcile] failed", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_cleanup_reconcile_failed",
          message: "Failed to reconcile Earn cleanup ghosts.",
        },
      },
      { status: 500 }
    );
  }
}

export const GET = handleCronRequest;
export const POST = handleCronRequest;
