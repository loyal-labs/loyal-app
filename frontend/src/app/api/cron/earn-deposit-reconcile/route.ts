import { NextResponse } from "next/server";

import { reconcileInvisibleEarnDeposits } from "@/lib/yield-optimization/earn-deposit-reconcile.server";

import { validateCronAuthHeader } from "../_shared/auth";

// Reconciles two lost-confirm stages through the canonical repository writers:
// policy-only onboarding strands first, then deposits that landed but remain
// invisible. Every adoption is an operational signal that the normal confirm
// path lost an acknowledgement. `?dryRun=1` scans and reports without writing.
export const maxDuration = 300;

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  // Scheduled runs scan only recently-touched accounts to respect the 5 rps
  // Helius budget; `?full=1` runs the unbounded fleet sweep on demand.
  const fullScan = params.get("full") === "1";
  try {
    const summary = await reconcileInvisibleEarnDeposits({ dryRun, fullScan });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[cron/earn-deposit-reconcile] failed", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_deposit_reconcile_failed",
          message: "Failed to reconcile invisible Earn deposits.",
        },
      },
      { status: 500 }
    );
  }
}

export const GET = handleCronRequest;
export const POST = handleCronRequest;
