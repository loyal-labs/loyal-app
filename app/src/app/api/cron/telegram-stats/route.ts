import { NextResponse } from "next/server";

import { loadLoyalStats } from "@/lib/telegram/bot-api/stats-command.server";
import { upsertLoyalStatsSnapshot } from "@/lib/telegram/bot-api/stats-persistence.server";

import { validateCronAuthHeader } from "../_shared/auth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  const authErrorResponse = validateCronAuthHeader(request);
  if (authErrorResponse) {
    return authErrorResponse;
  }

  const startedAt = Date.now();

  try {
    const stats = await loadLoyalStats();
    const refreshedAt = new Date();
    await upsertLoyalStatsSnapshot(stats, refreshedAt);

    const elapsedMs = Date.now() - startedAt;
    console.info("[cron/telegram-stats] Snapshot refreshed", {
      elapsedMs,
      refreshedAt: refreshedAt.toISOString(),
    });

    return NextResponse.json({
      elapsedMs,
      ok: true,
      refreshedAt: refreshedAt.toISOString(),
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error("[cron/telegram-stats] Snapshot refresh failed", {
      elapsedMs,
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      { error: "Stats snapshot refresh failed", ok: false },
      { status: 500 }
    );
  }
}
