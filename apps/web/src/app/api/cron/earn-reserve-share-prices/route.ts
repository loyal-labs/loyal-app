import { NextResponse } from "next/server";

import {
  type EarnFleetAllocationRecordResult,
  recordEarnFleetAllocationNow,
} from "@/lib/kamino/earn-fleet-allocation.server";
import { recordEarnReserveSharePricesNow } from "@/lib/kamino/reserve-share-price.server";

import { validateCronAuthHeader } from "../_shared/auth";

// The allocation read may use its full 30 second limit before prices start.
export const maxDuration = 120;

async function handleCronRequest(request: Request) {
  const authError = validateCronAuthHeader(request);
  if (authError) {
    return authError;
  }

  // The allocation runs first so its reserves are priced in the same run. A
  // failed allocation sample must not cost the hour's share prices.
  let allocation: EarnFleetAllocationRecordResult | null = null;
  try {
    allocation = await recordEarnFleetAllocationNow();
    if (allocation.vaultsIncluded < allocation.vaultsTotal) {
      console.warn("[cron/earn-reserve-share-prices] incomplete fleet", {
        allocation,
      });
    }
  } catch (error) {
    console.error(
      "[cron/earn-reserve-share-prices] Allocation recording failed",
      error
    );
  }

  try {
    // Prices take their own clock: a reserve updated while the allocation was
    // being read must not look like it came from the future.
    const result = await recordEarnReserveSharePricesNow(
      new Date(),
      allocation?.reserves ?? []
    );
    if (result.missing.length > 0) {
      console.warn("[cron/earn-reserve-share-prices] missing reserves", {
        missing: result.missing,
      });
    }
    return NextResponse.json(
      { ...result, allocation },
      { status: allocation ? 200 : 500 }
    );
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
