import { NextResponse } from "next/server";

import { reconcileInvisibleEarnDeposits } from "@/lib/yield-optimization/earn-deposit-reconcile.server";

import { validateCronAuthHeader } from "../_shared/auth";

// Adopts Earn deposits that landed on-chain but whose deposit-confirm was lost
// or rejected (no yield DB rows → the app shows nothing). This is the safety
// net behind the confirm path — every adoption it reports is a confirm the
// normal path lost. `?dryRun=1` scans and reports without writing.
export const maxDuration = 300;

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    const summary = await reconcileInvisibleEarnDeposits({ dryRun });
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
