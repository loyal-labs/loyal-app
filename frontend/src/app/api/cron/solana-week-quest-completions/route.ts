import { NextResponse } from "next/server";

import { reconcileQuestCompletions } from "@/features/solana-week/server/quest-completion-service";

import { validateCronAuthHeader } from "../_shared/auth";

// Reconciliation backstop for Solana Week quest reporting. Real-time reporting
// already happens inline at manual deposit confirm (Quest 1) and via the sweep
// worker's notify call (Quest 2); this cron only retries rows not yet reported
// and backfills autodeposit sweeps that never produced a row (e.g. a missed
// notify). Fully idempotent — already-reported wallets cost a cheap DB read.
const DEFAULT_SWEEP_LOOKBACK_HOURS = 168; // 7 days — covers a week-long event.

function resolveSweepLookbackMs(): number {
  const raw = process.env.SOLANA_WEEK_SWEEP_LOOKBACK_HOURS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const hours =
    Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SWEEP_LOOKBACK_HOURS;
  return hours * 60 * 60 * 1000;
}

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  try {
    const summary = await reconcileQuestCompletions({
      sweepLookbackMs: resolveSweepLookbackMs(),
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[cron/solana-week-quest-completions] failed", error);
    return NextResponse.json(
      {
        error: {
          code: "solana_week_quest_reconcile_failed",
          message: "Failed to reconcile Solana Week quest completions.",
        },
      },
      { status: 500 }
    );
  }
}

export const GET = handleCronRequest;
export const POST = handleCronRequest;
