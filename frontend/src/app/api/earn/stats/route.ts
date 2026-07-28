import { NextResponse } from "next/server";

import { getEarnPublicStats } from "@/lib/yield-optimization/earn-public-stats.server";

// Public protocol stats (same numbers as the public dashboard) — no auth.
export async function GET() {
  try {
    const stats = await getEarnPublicStats();
    return NextResponse.json(stats, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.warn("[earn-stats] failed to load public stats", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_stats_unavailable",
          message: "Earn stats are unavailable.",
        },
      },
      { status: 503 }
    );
  }
}
