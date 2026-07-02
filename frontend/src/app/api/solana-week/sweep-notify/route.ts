import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportFirstAutodepositSweepQuestCompletion } from "@/features/solana-week/server/quest-completion-service";
import { getOptionalEnv } from "@/lib/core/config/shared";
import {
  autodepositSweepExecutedPush,
  autodepositSweepScheduledPush,
  sendWalletPush,
} from "@/lib/push-notifications/wallet-push.server";
import { findLatestEarnAutodepositExecutionForWallet } from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Internal backend-to-backend endpoint the autodeposit sweep worker calls the
// moment it records a confirmed sweep, so Quest 2 ("first Earn deposit via
// autodeposit") is reported in real time instead of waiting for the cron, and
// the wallet's devices get the transactional push (ASK-1651).
// Authenticated with SOLANA_WEEK_NOTIFY_SECRET (Bearer).
// Body: { walletAddress, kind?: "scheduled" | "executed", amountRaw?: string }.
// `kind` defaults to "executed" (the only event the worker sent historically);
// "scheduled" is push-only and skips quest reporting.
function isAuthorized(request: Request): boolean {
  const secret = getOptionalEnv(process.env, "SOLANA_WEEK_NOTIFY_SECRET");
  if (!secret) {
    return false;
  }
  const header = request.headers.get("authorization");
  if (!header) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const walletAddress = record.walletAddress;
  if (typeof walletAddress !== "string" || !walletAddress.trim()) {
    return NextResponse.json(
      { error: "invalid_request", message: "walletAddress is required." },
      { status: 400 }
    );
  }

  const kind = record.kind === "scheduled" ? "scheduled" : "executed";
  let amountRaw = parseAmountRaw(record.amountRaw);

  if (kind === "scheduled") {
    await sendWalletPush(
      walletAddress,
      autodepositSweepScheduledPush(amountRaw)
    );
    return NextResponse.json({ status: "accepted" });
  }

  // Best-effort + idempotent; never throws.
  await reportFirstAutodepositSweepQuestCompletion(walletAddress, {
    source: "sweep-worker-notify",
  });

  if (amountRaw === null) {
    // Worker payloads don't carry the amount yet; the execution row the
    // worker just recorded does. Only trust it while fresh so a delayed
    // notify can't attribute a previous sweep's amount.
    try {
      const execution =
        await findLatestEarnAutodepositExecutionForWallet(walletAddress);
      if (
        execution &&
        Date.now() - execution.recordedAt.getTime() <
          EXECUTION_AMOUNT_FRESHNESS_MS
      ) {
        amountRaw = execution.amountRaw;
      }
    } catch (error) {
      console.warn("[sweep-notify] execution amount lookup failed", {
        errorMessage:
          error instanceof Error ? error.message : "Unknown lookup error.",
        walletAddress,
      });
    }
  }

  await sendWalletPush(walletAddress, autodepositSweepExecutedPush(amountRaw));

  return NextResponse.json({ status: "accepted" });
}

const EXECUTION_AMOUNT_FRESHNESS_MS = 15 * 60 * 1000;

function parseAmountRaw(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = BigInt(value);
  return parsed > BigInt(0) ? parsed : null;
}
