import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createSessionPayload,
  getSessionCookieOptions,
  isSafeNextPath,
  signSessionToken,
  validateAdminCredentials,
} from "@/lib/admin-auth";

function getPostLoginPath(nextPathValue: string | null | undefined) {
  if (!nextPathValue || !isSafeNextPath(nextPathValue)) {
    return "/overview";
  }

  return nextPathValue === "/" ? "/overview" : nextPathValue;
}

function getLoginRedirectUrl(
  request: NextRequest,
  nextPath?: string,
  error?: "invalid"
) {
  const url = new URL("/login", request.url);
  if (error) {
    url.searchParams.set("error", error);
  }
  if (nextPath && nextPath !== "/overview") {
    url.searchParams.set("next", nextPath);
  }
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const login = formData.get("login");
  const password = formData.get("password");
  const nextPathValue = formData.get("next");
  const nextPath =
    typeof nextPathValue === "string"
      ? getPostLoginPath(nextPathValue)
      : "/overview";

  if (typeof login !== "string" || typeof password !== "string") {
    return NextResponse.redirect(
      getLoginRedirectUrl(request, nextPath, "invalid"),
      { status: 303 }
    );
  }

  if (!validateAdminCredentials(login, password)) {
    return NextResponse.redirect(
      getLoginRedirectUrl(request, nextPath, "invalid"),
      { status: 303 }
    );
  }

  const token = await signSessionToken(createSessionPayload(login));
  if (!token) {
    return NextResponse.redirect(
      getLoginRedirectUrl(request, nextPath, "invalid"),
      { status: 303 }
    );
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), {
    status: 303,
  });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    ...getSessionCookieOptions(),
  });

  return response;
}
