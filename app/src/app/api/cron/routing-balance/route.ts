import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/core/config/server";
import { runRoutingBalanceWatchdog } from "@/lib/telegram/bot-api/routing-balance-alert.server";
import { readRoutingKeyBalances } from "@/lib/telegram/bot-api/routing-balance-rpc.server";
import {
  loadRoutingBalanceAlertState,
  saveRoutingBalanceAlertState,
} from "@/lib/telegram/bot-api/stats-persistence.server";

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
    const publicKeys = serverEnv.solanaRoutingAlertPublicKeys;
    if (publicKeys.length === 0) {
      const elapsedMs = Date.now() - startedAt;
      console.error("[cron/routing-balance] No routing keys configured", {
        elapsedMs,
      });
      return NextResponse.json(
        { elapsedMs, ok: true, skipped: "no_routing_keys_configured" },
        { status: 202 }
      );
    }

    const [{ balances, failures }, previousState] = await Promise.all([
      readRoutingKeyBalances(publicKeys),
      loadRoutingBalanceAlertState(),
    ]);

    for (const failure of failures) {
      console.error("[cron/routing-balance] Balance read failed", {
        errorMessage: failure.errorMessage,
        publicKey: failure.publicKey,
      });
    }

    const { deliveries, nextState, stateChanged } =
      await runRoutingBalanceWatchdog(balances, previousState);

    for (const delivery of deliveries) {
      if (delivery.status === "sent") {
        continue;
      }

      console.error(`[cron/routing-balance] Slack alert ${delivery.status}`, {
        bucket: delivery.alert.bucket,
        lamports: delivery.alert.lamports.toString(),
        publicKey: delivery.alert.publicKey,
      });
    }

    if (stateChanged) {
      const persisted = await saveRoutingBalanceAlertState(nextState);
      if (!persisted) {
        console.error(
          "[cron/routing-balance] Stats snapshot row is missing, alert state not persisted"
        );
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.info("[cron/routing-balance] Checked routing key balances", {
      alertsSent: deliveries.filter((delivery) => delivery.status === "sent")
        .length,
      checkedKeys: balances.length,
      elapsedMs,
      failedKeys: failures.length,
    });

    return NextResponse.json({
      alerts: deliveries.map((delivery) => ({
        bucket: delivery.alert.bucket,
        publicKey: delivery.alert.publicKey,
        status: delivery.status,
      })),
      checkedKeys: balances.length,
      elapsedMs,
      failedKeys: failures.length,
      ok: true,
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error("[cron/routing-balance] Routing balance check failed", {
      elapsedMs,
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      { error: "Routing balance check failed", ok: false },
      { status: 500 }
    );
  }
}
