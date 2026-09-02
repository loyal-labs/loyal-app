import { NextResponse } from "next/server";
import { z } from "zod";

import { completePrivyAuth } from "@/features/identity/server/privy-auth";
import { createAuthSessionCookieService } from "@/features/identity/server/session-cookie";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { isSmartAccountProvisioningError } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";

const bodySchema = z.object({
  walletAddress: z.string().min(32).max(64),
});

// Exchanges a Privy identity token (header `privy-id-token`) for the Loyal
// session cookie. Everything downstream (routes, refresh, logout) is unchanged.
export async function POST(request: Request) {
  const identityToken = request.headers.get("privy-id-token");
  if (!identityToken) {
    return NextResponse.json(
      {
        error: {
          code: "privy_identity_token_missing",
          message: "Missing Privy identity token.",
        },
      },
      { status: 401 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_privy_completion_request",
          message: "Request is invalid.",
        },
      },
      { status: 400 }
    );
  }

  try {
    const result = await completePrivyAuth({
      identityToken,
      walletAddress: parsed.data.walletAddress,
      requestOrigin:
        request.headers.get("origin") ?? new URL(request.url).origin,
    });
    const cookies = createAuthSessionCookieService({
      getConfig: () => getServerEnv(),
    });
    const response = NextResponse.json({ user: result.user });
    response.cookies.set({
      name: cookies.getSessionCookieName(request),
      value: result.sessionToken,
      ...cookies.createSessionCookieOptions(request),
    });
    return response;
  } catch (error) {
    if (
      error instanceof WalletAuthError ||
      isSmartAccountProvisioningError(error)
    ) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    throw error;
  }
}
