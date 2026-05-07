import { NextResponse } from "next/server";

import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { createWalletAuthChallenge } from "@/features/identity/server/wallet-auth-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const response = await createWalletAuthChallenge(body, {
      requestOrigin:
        request.headers.get("origin") ?? new URL(request.url).origin,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {}),
          },
        },
        { status: error.status }
      );
    }

    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        {
          error: {
            code: "invalid_wallet_challenge_request",
            message: "Wallet challenge request is invalid.",
          },
        },
        { status: 400 }
      );
    }

    throw error;
  }
}
