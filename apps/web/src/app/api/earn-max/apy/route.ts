import { NextResponse } from "next/server";

import { readEarnMaxVoltrApy } from "@/features/earn-max/voltr/apy.server";

// Public vault APY (Voltr share price) for screens shown before the invite
// unlocks the account data — no auth, like /api/earn/stats.
export async function GET() {
  const { apyBps, apyWindowDays } = await readEarnMaxVoltrApy();
  return NextResponse.json(
    { apyBps, apyWindowDays },
    {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    }
  );
}
