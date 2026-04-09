import { NextResponse } from "next/server";

import {
  createAuthSessionCookieService,
  WALLET_AUTH_SESSION_COOKIE_NAME,
} from "@/features/identity/server/session-cookie";
import { getServerEnv } from "@/lib/core/config/server";

export async function POST(request: Request) {
  const sessionCookieService = createAuthSessionCookieService({
    getConfig: () => getServerEnv(),
  });
  const response = new NextResponse(null, { status: 204 });

  response.cookies.set({
    name: WALLET_AUTH_SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieService.createClearedSessionCookieOptions(request),
  });

  return response;
}
