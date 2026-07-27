import { NextResponse } from "next/server";

import {
  createCapChallenge,
  getCapSecret,
} from "@/features/identity/server/cap-captcha";

export async function POST() {
  const secret = getCapSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "captcha_not_configured" },
      { status: 503 }
    );
  }

  return NextResponse.json(await createCapChallenge(secret));
}
