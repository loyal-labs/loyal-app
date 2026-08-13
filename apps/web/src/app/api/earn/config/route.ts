import { NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/core/config/public";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      enabledStablecoins: getPublicEnv().earnEnabledStablecoins,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
