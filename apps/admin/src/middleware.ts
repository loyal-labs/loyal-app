import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createSessionPayload,
  getSafeNextPath,
  getSessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from "@/lib/admin-auth";

const PUBLIC_PATHS = new Set([
  "/login",
  "/auth/login",
  "/logout",
  "/favicon.ico",
  "/icon.svg",
]);

function isPublicAsset(pathname: string) {
  if (pathname.startsWith("/_next/")) {
    return true;
  }

  return /\.[^/]+$/.test(pathname);
}

async function renewSession(response: NextResponse, user: string) {
  const token = await signSessionToken(createSessionPayload(user));
  if (token) {
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      ...getSessionCookieOptions(),
    });
  }

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const sessionToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const session = await verifySessionToken(sessionToken);

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/login") {
    if (!session) {
      return NextResponse.next();
    }

    const requestedNextPath = request.nextUrl.searchParams.get("next");
    const safeNextPath = getSafeNextPath(requestedNextPath, request.url);
    const destinationCandidate =
      !safeNextPath || safeNextPath === "/" ? "/overview" : safeNextPath;
    const destination =
      destinationCandidate === "/login" ? "/overview" : destinationCandidate;

    return renewSession(
      NextResponse.redirect(new URL(destination, request.url), {
        status: 302,
      }),
      session.sub
    );
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (session) {
    return renewSession(NextResponse.next(), session.sub);
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = `${pathname}${search}`;
  const safeNextPath = getSafeNextPath(nextPath, request.url);
  if (safeNextPath) {
    loginUrl.searchParams.set("next", safeNextPath);
  }

  const status =
    request.method === "GET" || request.method === "HEAD" ? 302 : 303;
  return NextResponse.redirect(loginUrl, { status });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)"],
};
