import { NextResponse } from "next/server";

import { runYieldRoutingCron } from "@/features/yield-routing/server/runner";

export const dynamic = "force-dynamic";

function isCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized_cron",
          message: "Cron authorization is required.",
        },
      },
      { status: 401 }
    );
  }

  const result = await runYieldRoutingCron({});

  return NextResponse.json({
    ok: true,
    mode: "metadata_scan",
    ...result,
  });
}
