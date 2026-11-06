import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// backyard.askloyal.com serves only the read-only Backyard vault pages:
// /           -> /backyard/earn
// /earn       -> /backyard/earn
// /looping    -> /backyard/looping
// Assets pass through; any other path is a 404 on that host.
const VAULTS = new Set(["earn", "looping"]);

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!host.startsWith("backyard.")) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next/") || /\.[^/]+$/.test(pathname)) {
    return NextResponse.next();
  }
  const slug = pathname === "/" ? "earn" : pathname.slice(1);
  const url = request.nextUrl.clone();
  // An unknown slug renders the vault page's notFound().
  url.pathname = `/backyard/${VAULTS.has(slug) ? slug : "unknown"}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
