import { NextResponse } from "next/server";

import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import {
  createAuthSessionCookieService,
  WALLET_AUTH_SESSION_COOKIE_NAME,
} from "@/features/identity/server/session-cookie";
import { completeWalletAuth } from "@/features/identity/server/wallet-auth-service";
import { isSmartAccountProvisioningError } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { createRequestLifecycle } from "@/features/observability/lifecycle.server";
import { normalizeLifecycleErrorCode } from "@/features/observability/lifecycle-contract";

export async function POST(request: Request) {
  const lifecycle = createRequestLifecycle({
    flowName: "auth.smart_account_provisioning",
    flowVariant: "wallet_onboarding",
    request,
  });
  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const response = await completeWalletAuth(body, {
      ...(lifecycle ? { lifecycle } : {}),
      requestOrigin:
        request.headers.get("origin") ?? new URL(request.url).origin,
    });
    const sessionCookieService = createAuthSessionCookieService({
      getConfig: () => getServerEnv(),
    });
    const nextResponse = NextResponse.json({
      user: response.user,
    });

    nextResponse.cookies.set({
      name: WALLET_AUTH_SESSION_COOKIE_NAME,
      value: response.sessionToken,
      ...sessionCookieService.createSessionCookieOptions(request),
    });

    return nextResponse;
  } catch (error) {
    lifecycle?.tracker.fail("proof_verify", {
      errorCode: normalizeLifecycleErrorCode(
        error instanceof WalletAuthError ||
          isSmartAccountProvisioningError(error)
          ? error.code
          : undefined
      ),
    });
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

    if (isSmartAccountProvisioningError(error)) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status }
      );
    }

    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        {
          error: {
            code: "invalid_wallet_completion_request",
            message: "Wallet completion request is invalid.",
          },
        },
        { status: 400 }
      );
    }

    throw error;
  }
}
