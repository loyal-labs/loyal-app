import { NextResponse } from "next/server";

import { recordEarnReserveSharePricesNow } from "@/lib/kamino/reserve-share-price.server";

import { validateCronAuthHeader } from "../_shared/auth";

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  try {
    const result = await recordEarnReserveSharePricesNow();
    if (result.missing.length > 0) {
      console.warn("[cron/earn-reserve-share-prices] missing reserves", {
        missing: result.missing,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/earn-reserve-share-prices] Recording failed", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_reserve_share_prices_failed",
          message: "Failed to record Earn reserve share prices.",
        },
      },
      { status: 500 }
    );
  }
}

export const GET = handleCronRequest;
export const POST = handleCronRequest;
