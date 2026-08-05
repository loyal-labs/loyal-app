import { NextResponse } from "next/server";
import { getPolicySigner } from "@/lib/server/config";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      cluster: "mainnet-beta",
      policySigner: getPolicySigner().publicKey.toBase58(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Server configuration unavailable.",
      },
      { status: 503 }
    );
  }
}
