import { NextResponse } from "next/server";

import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { createWalletAuthChallenge } from "@/features/identity/server/wallet-auth-service";
import { verifyTurnstileToken } from "@/features/identity/server/turnstile-verification";

function splitTurnstileToken(body: unknown): {
  turnstileToken: string | undefined;
  challengeBody: unknown;
} {
  if (typeof body !== "object" || body === null) {
    return { turnstileToken: undefined, challengeBody: body };
  }

  const { turnstileToken, ...rest } = body as Record<string, unknown>;
  return {
    turnstileToken:
      typeof turnstileToken === "string" ? turnstileToken : undefined,
    challengeBody: rest,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const { turnstileToken, challengeBody } = splitTurnstileToken(body);

    const verification = await verifyTurnstileToken({
      token: turnstileToken,
      remoteIp:
        request.headers.get("cf-connecting-ip") ??
        request.headers.get("x-forwarded-for"),
    });
    if (!verification.ok) {
      return NextResponse.json(
        {
          error: {
            code: "turnstile_verification_failed",
            message: "Captcha verification failed. Please try again.",
          },
        },
        { status: 403 }
      );
    }

    const response = await createWalletAuthChallenge(challengeBody, {
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
