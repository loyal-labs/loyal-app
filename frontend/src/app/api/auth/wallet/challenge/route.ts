import { NextResponse } from "next/server";

import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { createWalletAuthChallenge } from "@/features/identity/server/wallet-auth-service";
import { verifyCaptchaToken } from "@/features/identity/server/cap-captcha";

function splitCaptchaToken(body: unknown): {
  captchaToken: string | undefined;
  challengeBody: unknown;
} {
  if (typeof body !== "object" || body === null) {
    return { captchaToken: undefined, challengeBody: body };
  }

  const { captchaToken, ...rest } = body as Record<string, unknown>;
  return {
    captchaToken: typeof captchaToken === "string" ? captchaToken : undefined,
    challengeBody: rest,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const { captchaToken, challengeBody } = splitCaptchaToken(body);

    const verification = await verifyCaptchaToken({ token: captchaToken });
    if (!verification.ok) {
      return NextResponse.json(
        {
          error: {
            code: "captcha_verification_failed",
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
