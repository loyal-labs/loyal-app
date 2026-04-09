import { NextResponse } from "next/server";
import { mapAuthSessionTokenClaimsToUser } from "@loyal-labs/auth-core";

import { createAuthSessionCookieService } from "@/features/identity/server/session-cookie";
import { getServerEnv } from "@/lib/core/config/server";

export async function GET(request: Request) {
  const sessionCookieService = createAuthSessionCookieService({
    getConfig: () => getServerEnv(),
  });
  const claims = await sessionCookieService.readSessionClaimsFromRequest(request);

  if (!claims) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "No active auth session.",
        },
      },
      { status: 401 }
    );
  }

  const user = mapAuthSessionTokenClaimsToUser(claims);
  const session = sessionCookieService.getSessionMetadata(claims);

  return NextResponse.json({ user, session });
}
