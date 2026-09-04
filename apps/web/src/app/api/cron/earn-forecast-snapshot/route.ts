import { NextResponse } from "next/server";

import { refreshMediumFeeAwareEarnForecastSnapshot } from "@/lib/kamino/earn-forecast.server";

import { validateCronAuthHeader } from "../_shared/auth";

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  try {
    const result = await refreshMediumFeeAwareEarnForecastSnapshot();

    return NextResponse.json({
      generatedAt: result.generatedAt,
      insertedOrUpdated: result.insertedOrUpdated,
      loyalSampleCount: result.loyalSampleCount,
      mainUsdcReserveSampleCount: result.mainUsdcReserveSampleCount,
      sampleCount: result.sampleCount,
      window: result.forecast.summary.window,
    });
  } catch (error) {
    console.error("[cron/earn-forecast-snapshot] Refresh failed", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_forecast_snapshot_refresh_failed",
          message: "Failed to refresh Earn forecast snapshot.",
        },
      },
      { status: 500 }
    );
  }
}

export const GET = handleCronRequest;
export const POST = handleCronRequest;
