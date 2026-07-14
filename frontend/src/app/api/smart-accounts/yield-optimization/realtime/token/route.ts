import { NextResponse } from "next/server";

import { issueEarnRealtimeToken } from "@/features/earn-realtime/server/token.server";
import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { headers: { "Cache-Control": "no-store" }, status }
  );
}

async function hasClientControlledClaims(request: Request): Promise<boolean> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return false;
  }
  const body: unknown = await request.json().catch(() => null);
  return (
    typeof body === "object" &&
    body !== null &&
    Object.keys(body as Record<string, unknown>).length > 0
  );
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  if (await hasClientControlledClaims(request)) {
    return jsonError(
      400,
      "invalid_request",
      "Realtime identity is derived from the authenticated session."
    );
  }

  try {
    const serverEnv = getServerEnv();
    const authSecret = serverEnv.earnRealtime.authSecret;
    if (!authSecret) {
      return jsonError(
        503,
        "realtime_unavailable",
        "Earn realtime is temporarily unavailable."
      );
    }
    const issued = issueEarnRealtimeToken({
      authSecret,
      principal,
      programId: serverEnv.loyalSmartAccounts.programId,
      solanaEnv: serverEnv.solanaEnv,
    });

    return NextResponse.json(
      {
        accessToken: issued.accessToken,
        eventsUrl: serverEnv.earnRealtime.eventsUrl,
        expiresAt: issued.expiresAt,
        schemaVersion: 1,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[earn-realtime-token] issuance failed", {
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unknown token issuance error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settingsPda: principal.settingsPda,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      503,
      "realtime_unavailable",
      "Earn realtime is temporarily unavailable."
    );
  }
}
