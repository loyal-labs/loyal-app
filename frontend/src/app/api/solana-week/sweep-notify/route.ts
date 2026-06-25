import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportFirstAutodepositSweepQuestCompletion } from "@/features/solana-week/server/quest-completion-service";
import { getOptionalEnv } from "@/lib/core/config/shared";

// Internal backend-to-backend endpoint the autodeposit sweep worker calls the
// moment it records a confirmed sweep, so Quest 2 ("first Earn deposit via
// autodeposit") is reported in real time instead of waiting for the cron.
// Authenticated with SOLANA_WEEK_NOTIFY_SECRET (Bearer). Body: { walletAddress }.
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

  const walletAddress =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).walletAddress
      : undefined;
  if (typeof walletAddress !== "string" || !walletAddress.trim()) {
    return NextResponse.json(
      { error: "invalid_request", message: "walletAddress is required." },
      { status: 400 }
    );
  }

  // Best-effort + idempotent; never throws.
  await reportFirstAutodepositSweepQuestCompletion(walletAddress, {
    source: "sweep-worker-notify",
  });

  return NextResponse.json({ status: "accepted" });
}
