import { NextResponse } from "next/server";
import { mapAuthSessionTokenClaimsToUser } from "@loyal-labs/auth-core";

import {
  createAuthSessionCookieService,
  WALLET_AUTH_SESSION_COOKIE_NAME,
} from "@/features/identity/server/session-cookie";
import { getServerEnv } from "@/lib/core/config/server";

export async function POST(request: Request) {
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
  const response = NextResponse.json({
    user,
    session: sessionCookieService.getSessionMetadata(claims),
  });

  if (!sessionCookieService.shouldRefreshSessionToken(claims)) {
    return response;
  }

  const refreshedToken = await sessionCookieService.issueSessionToken(user);
  const refreshedClaims =
    await sessionCookieService.readSessionClaimsFromRequest(
      new Request(request.url, {
        headers: {
          cookie: `${WALLET_AUTH_SESSION_COOKIE_NAME}=${refreshedToken}`,
        },
      })
    );

  response.cookies.set({
    name: WALLET_AUTH_SESSION_COOKIE_NAME,
    value: refreshedToken,
    ...sessionCookieService.createSessionCookieOptions(request),
  });

  if (!refreshedClaims) {
    return response;
  }

  return NextResponse.json(
    {
      user: mapAuthSessionTokenClaimsToUser(refreshedClaims),
      session: sessionCookieService.getSessionMetadata(refreshedClaims),
    },
    {
      headers: response.headers,
      status: response.status,
    }
  );
}
