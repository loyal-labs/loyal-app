import { NextResponse } from "next/server";

import {
  LOYAL_TICKER_RESPONSE_CACHE_CONTROL,
  readLoyalTokenTicker,
} from "@/lib/market/loyal-token-ticker.server";

export async function GET() {
  try {
    const ticker = await readLoyalTokenTicker();
    return NextResponse.json(ticker, {
      headers: { "Cache-Control": LOYAL_TICKER_RESPONSE_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("[api/tokens/loyal-ticker] ticker read failed", {
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "LOYAL ticker is temporarily unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }
}
