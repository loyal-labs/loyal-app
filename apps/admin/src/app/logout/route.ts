import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  getSessionCookieOptions,
} from "@/lib/admin-auth";

function clearSession(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

export function GET(request: NextRequest) {
  return clearSession(request);
}

export function POST(request: NextRequest) {
  return clearSession(request);
}
