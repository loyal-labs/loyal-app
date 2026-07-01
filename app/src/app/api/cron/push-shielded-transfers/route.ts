import { NextResponse } from "next/server";

import { runPushShieldedTransfersCron } from "@/features/push-shielded-transfers";

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
    const stats = await runPushShieldedTransfersCron();
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    console.error("[cron/push-shielded-transfers] Run failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      },
      { status: 500 }
    );
  }
}
