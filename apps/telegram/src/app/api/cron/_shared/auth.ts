import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/core/config/server";

export function validateCronAuthHeader(request: Request): NextResponse | null {
  let expectedToken: string;
  try {
    expectedToken = serverEnv.cronSecret;
  } catch {
    console.error("CRON_SECRET environment variable is not set");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const provided = Buffer.from(authHeader);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
