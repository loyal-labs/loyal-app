import { NextResponse } from "next/server";

import { reconcileRecoverableSmartAccounts } from "@/features/smart-accounts/server/reconciler";

import { validateCronAuthHeader } from "../_shared/auth";

// Repairs smart accounts stuck in `failed`/stale `provisioning` states
// (sponsor outages, concurrent-signup index races) before the user retries.
// The same repair already runs inline on a user's next attempt — this cron
// just gets there first, so returning users never see a second error.
async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  try {
    const summary = await reconcileRecoverableSmartAccounts();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[cron/smart-account-reconcile] failed", error);
    return NextResponse.json(
      {
        error: {
          code: "smart_account_reconcile_failed",
          message: "Failed to reconcile recoverable smart accounts.",
        },
      },
      { status: 500 }
    );
  }
}

export const GET = handleCronRequest;
export const POST = handleCronRequest;
