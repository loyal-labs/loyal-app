import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  isSafeNextPath,
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
    const destinationCandidate =
      requestedNextPath && isSafeNextPath(requestedNextPath)
        ? requestedNextPath === "/"
          ? "/overview"
          : requestedNextPath
        : "/overview";
    const destination =
      destinationCandidate === "/login" ? "/overview" : destinationCandidate;

    return NextResponse.redirect(new URL(destination, request.url), {
      status: 302,
    });
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (session) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = `${pathname}${search}`;
  if (isSafeNextPath(nextPath)) {
    loginUrl.searchParams.set("next", nextPath);
  }

  const status =
    request.method === "GET" || request.method === "HEAD" ? 302 : 303;
  return NextResponse.redirect(loginUrl, { status });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)"],
};
