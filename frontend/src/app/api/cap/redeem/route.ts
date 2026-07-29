import { NextResponse } from "next/server";
import type { ValidateChallengeBody } from "capjs-core";

import {
  getCapSecret,
  redeemCapChallenge,
} from "@/features/identity/server/cap-captcha";

export async function POST(request: Request) {
  const secret = getCapSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "captcha_not_configured" },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | ValidateChallengeBody
    | null;
  if (!body) {
    return NextResponse.json(
      { success: false, error: "invalid_body" },
      { status: 400 }
    );
  }

  // validateChallenge rejects malformed bodies itself (invalid_body /
  // missing_token / missing_solutions), so no schema layer here.
  const result = await redeemCapChallenge(secret, body);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.reason },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    token: result.token,
    expires: result.expires,
  });
}
