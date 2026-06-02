import { NextResponse } from "next/server";

import { getSafeNoFeeEarnForecast } from "@/lib/kamino/earn-forecast.server";

export async function GET() {
  const forecast = await getSafeNoFeeEarnForecast();

  return NextResponse.json(forecast);
}
