import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// backyard.askloyal.com serves only the read-only Backyard page at "/".
// Assets pass through; any other path is a 404 on that host.
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!host.startsWith("backyard.")) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next/") || /\.[^/]+$/.test(pathname)) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  // A path with no route renders the app's 404.
  url.pathname = pathname === "/" ? "/backyard" : "/backyard/not-found";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
