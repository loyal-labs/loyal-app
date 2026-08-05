import { NextResponse } from "next/server";
import { mapAuthSessionTokenClaimsToUser } from "@loyal-labs/auth-core";

import { createAuthSessionCookieService } from "@/features/identity/server/session-cookie";
import { getServerEnv } from "@/lib/core/config/server";

export async function POST(request: Request) {
  const sessionCookieService = createAuthSessionCookieService({
    getConfig: () => getServerEnv(),
  });
  const claims = await sessionCookieService.readSessionClaimsFromRequest(
    request
  );

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
  const sessionCookieName = sessionCookieService.getSessionCookieName(request);
  const refreshedClaims =
    await sessionCookieService.readSessionClaimsFromRequest(
      new Request(request.url, {
        headers: {
          cookie: `${
            request.headers.get("cookie") ?? ""
          }; ${sessionCookieName}=${refreshedToken}`,
        },
      })
    );

  response.cookies.set({
    name: sessionCookieName,
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
