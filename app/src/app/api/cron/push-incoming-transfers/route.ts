import { NextResponse } from "next/server";

import { runPushIncomingTransfersCron } from "@/features/push-incoming-transfers";

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
    const stats = await runPushIncomingTransfersCron();
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    console.error("[cron/push-incoming-transfers] Run failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      },
      { status: 500 }
    );
  }
}
