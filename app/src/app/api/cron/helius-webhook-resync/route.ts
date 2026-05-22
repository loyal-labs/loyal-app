import { NextResponse } from "next/server";

import { runHeliusWebhookResync } from "@/features/push-incoming-transfers/server/resync";

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

  try {
    const stats = await runHeliusWebhookResync();
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    console.error("[cron/helius-webhook-resync] Run failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      },
      { status: 500 },
    );
  }
}
