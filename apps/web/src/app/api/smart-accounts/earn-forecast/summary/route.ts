import { NextResponse } from "next/server";

import { getMediumFeeAwareEarnForecast } from "@/lib/kamino/earn-forecast.server";

export async function GET() {
  const forecast = await getMediumFeeAwareEarnForecast();

  return NextResponse.json({
    forecast: forecast.summary,
    history: forecast.history,
  });
}
