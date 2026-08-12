import { NextResponse } from "next/server";

import { getQuestProgress } from "@/features/solana-week/server/quest-completion-service";

// Read-only Solana Week quest progress for the in-app quest page. Keyed by a
// supplied wallet address (no signature) — mirrors the read-only mobile Earn
// twins: it returns only this wallet's own quest-completion status, which is
// low-sensitivity and already implied by that wallet's on-chain activity.
// Solana's catalog GET stays authoritative for badge earned/locked/claim state.
export async function GET(request: Request) {
  const walletAddress =
    new URL(request.url).searchParams.get("walletAddress")?.trim() ?? "";
  if (!walletAddress) {
    return NextResponse.json(
      {
        error: { code: "invalid_request", message: "walletAddress is required." },
      },
      { status: 400 }
    );
  }

  try {
    const quests = await getQuestProgress(walletAddress);
    return NextResponse.json({ walletAddress, quests });
  } catch (error) {
    console.error("[solana-week] quest progress lookup failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown lookup error.",
    });
    return NextResponse.json(
      {
        error: {
          code: "internal_error",
          message: "Failed to load quest progress.",
        },
      },
      { status: 500 }
    );
  }
}
