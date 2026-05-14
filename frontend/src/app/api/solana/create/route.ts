import { NextResponse } from "next/server";

import { createSignInDataForEnv } from "@/lib/solana/sign-in";
import { getServerEnv } from "@/lib/core/config/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const signInData = await createSignInDataForEnv(getServerEnv().solanaEnv);
    return NextResponse.json(signInData);
  } catch (error) {
    console.error("Failed to create Solana sign-in payload", error);
    return NextResponse.json(
      { error: "Failed to create sign-in payload" },
      { status: 500 }
    );
  }
}
