import { NextResponse } from "next/server";

import { readEarnMaxVoltrApy } from "@/features/earn-max/voltr/apy.server";
import { readEarnMaxCurrentApyBps } from "@/features/earn-max/voltr/current-apy.server";

// Public vault APY for screens shown before the invite unlocks the account
// data — no auth, like /api/earn/stats. currentApyBps: live position now;
// apyBps: Voltr share-price growth over 7 days.
export async function GET() {
  const [{ apyBps, apyWindowDays }, currentApyBps] = await Promise.all([
    readEarnMaxVoltrApy(),
    readEarnMaxCurrentApyBps(),
  ]);
  return NextResponse.json(
    { apyBps, apyWindowDays, currentApyBps },
    {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    }
  );
}
