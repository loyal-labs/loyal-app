import "server-only";

import { timingSafeEqual } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { buildWebhookDeps } from "@/features/push-incoming-transfers/server/webhook-deps";
import {
  type HeliusEnhancedEvent,
  processHeliusWebhookPayload,
} from "@/features/push-incoming-transfers/server/webhook-handler";
import { serverEnv } from "@/lib/core/config/server";

// node:crypto requires the node runtime — explicit override here
// guards us against accidental edge-runtime promotion.
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = serverEnv.heliusWebhookSecret;
  const provided = req.headers.get("authorization") ?? "";
  if (!constantTimeEquals(provided, expected)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }
  if (!Array.isArray(body)) {
    return new NextResponse("expected array payload", { status: 400 });
  }

  try {
    const stats = await processHeliusWebhookPayload(
      body as HeliusEnhancedEvent[],
      buildWebhookDeps(),
    );
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("[helius-webhook] processing failed", {
      errorMessage: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : "Unknown",
    });
    return new NextResponse("processing error", { status: 500 });
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
