import { NextResponse } from "next/server";

import { issueMobileEarnSessionToken } from "@/features/identity/server/mobile-earn-session";
import {
  authenticateMobileWalletRequest,
  MOBILE_WALLET_AUTH_PURPOSES,
} from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";

// Mints the mobile Earn session token (ASK-1846): trade one wallet-signed auth
// message — scoped to ANY Earn purpose, so the app can piggyback on a
// signature the user is already making for a real flow — for a long-lived
// bearer token that the DB-only Autodeposit twins (sweeps/execute, floor,
// toggle) accept without further wallet prompts. Signature-gated proof of
// wallet control, no DB access; the token authorizes nothing a fresh signed
// message wouldn't.

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileWalletRequest({
      body,
      purpose: MOBILE_WALLET_AUTH_PURPOSES,
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  try {
    const session = await issueMobileEarnSessionToken(walletAddress);
    return NextResponse.json(session, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[mobile-earn-session] mint failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown mint error.",
      errorName: error instanceof Error ? error.name : typeof error,
      walletAddress,
    });
    return jsonError(
      500,
      "session_mint_failed",
      "Failed to mint a mobile Earn session."
    );
  }
}
