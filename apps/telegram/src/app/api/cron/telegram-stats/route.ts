import { NextResponse } from "next/server";

import { loadLoyalStats } from "@/lib/telegram/bot-api/stats-command.server";
import {
  loadLoyalStatsSnapshotForRefresh,
  upsertLoyalStatsSnapshot,
} from "@/lib/telegram/bot-api/stats-persistence.server";
import { sendLoyalStatsAumAlert } from "@/lib/telegram/bot-api/stats-slack-alert.server";

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
    const previousStats = await loadLoyalStatsSnapshotForRefresh();
    const stats = await loadLoyalStats();
    if (!stats) {
      const elapsedMs = Date.now() - startedAt;
      console.info("[cron/telegram-stats] Snapshot refresh already running", {
        elapsedMs,
      });
      return NextResponse.json(
        { elapsedMs, ok: true, skipped: "refresh_already_running" },
        { status: 202 }
      );
    }
    const refreshedAt = new Date();
    await upsertLoyalStatsSnapshot(stats, refreshedAt);

    const slackAlert = previousStats
      ? await sendLoyalStatsAumAlert(
          previousStats.totalAumRaw,
          stats.totalAumRaw
        )
      : { status: "skipped_no_previous_snapshot" as const };

    if (slackAlert.status === "failed") {
      console.error("[cron/telegram-stats] Slack AUM alert failed", {
        currentAumRaw: slackAlert.alert.currentAumRaw.toString(),
        deltaRaw: slackAlert.alert.deltaRaw.toString(),
      });
    } else if (slackAlert.status === "not_configured") {
      console.error("[cron/telegram-stats] Slack AUM alert is not configured", {
        currentAumRaw: slackAlert.alert.currentAumRaw.toString(),
        deltaRaw: slackAlert.alert.deltaRaw.toString(),
      });
    }

    const elapsedMs = Date.now() - startedAt;
    console.info("[cron/telegram-stats] Snapshot refreshed", {
      elapsedMs,
      refreshedAt: refreshedAt.toISOString(),
      slackAlertStatus: slackAlert.status,
    });

    return NextResponse.json({
      elapsedMs,
      ok: true,
      refreshedAt: refreshedAt.toISOString(),
      slackAlertStatus: slackAlert.status,
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
