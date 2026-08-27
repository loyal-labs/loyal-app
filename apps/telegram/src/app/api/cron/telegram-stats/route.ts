import { NextResponse } from "next/server";

import {
  loadFinalizedEarnFlows,
  loadLoyalStats,
} from "@/lib/telegram/bot-api/stats-command.server";
import {
  advanceLoyalStatsEarnFlowCursor,
  loadLoyalStatsSnapshotForRefresh,
  upsertLoyalStatsSnapshot,
} from "@/lib/telegram/bot-api/stats-persistence.server";
import { sendLoyalStatsEarnFlowAlert } from "@/lib/telegram/bot-api/stats-slack-alert.server";

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

    const flowBatch = await loadFinalizedEarnFlows(
      previousStats?.lastEarnFlowEventId ?? null,
      previousStats?.refreshedAt ?? null
    );
    let flowAlertStatus: "caught_up" | "failed" | "not_configured" =
      "caught_up";
    let processedFlowCount = 0;

    if (flowBatch.flows.length === 0) {
      await advanceLoyalStatsEarnFlowCursor(flowBatch.cursor);
    }

    for (const flow of flowBatch.flows) {
      const delivery = await sendLoyalStatsEarnFlowAlert(flow);
      if (
        delivery.status === "failed" ||
        delivery.status === "not_configured"
      ) {
        flowAlertStatus = delivery.status;
        console.error("[cron/telegram-stats] Slack Earn flow alert blocked", {
          eventId: flow.eventId.toString(),
          status: delivery.status,
        });
        break;
      }

      await advanceLoyalStatsEarnFlowCursor(flow.eventId);
      processedFlowCount += 1;
    }

    const elapsedMs = Date.now() - startedAt;
    console.info("[cron/telegram-stats] Snapshot refreshed", {
      elapsedMs,
      flowAlertStatus,
      processedFlowCount,
      refreshedAt: refreshedAt.toISOString(),
    });

    return NextResponse.json({
      elapsedMs,
      flowAlertStatus,
      ok: true,
      processedFlowCount,
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
