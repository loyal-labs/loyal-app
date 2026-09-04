import { NextResponse } from "next/server";

import { runEarnYieldJoy } from "@/lib/yield-optimization/earn-yield-joy.server";

import { validateCronAuthHeader } from "../_shared/auth";

// Daily driver for the Earn "joy" pushes (ASK-2091): first yield, total-earned
// milestones, the Loyal anniversary, and the self-tuning "+$X earned" digest.
// A wallet gets at most one of them per run. `?dryRun=1` decides without
// sending or writing state.
export const maxDuration = 300;

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    return NextResponse.json(await runEarnYieldJoy({ dryRun }));
  } catch (error) {
    console.error("[cron/earn-yield-joy] failed", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_yield_joy_failed",
          message: "Failed to run Earn yield joy pushes.",
        },
      },
      { status: 500 }
    );
  }
}

export const GET = handleCronRequest;
export const POST = handleCronRequest;
