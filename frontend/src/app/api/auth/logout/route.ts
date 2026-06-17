import { NextResponse } from "next/server";

import {
  createAuthSessionCookieService,
  WALLET_AUTH_SESSION_COOKIE_NAME,
} from "@/features/identity/server/session-cookie";
import {
  getOptionalEnv,
  isStrictTrue,
  isVercelPreviewEnv,
  parseAuthCookieParentDomains,
} from "@/lib/core/config/shared";

const AUTH_SESSION_RS256_PUBLIC_KEY_ENV_NAME = "AUTH_SESSION_RS256_PUBLIC_KEY";
const AUTH_SESSION_RS256_PRIVATE_KEY_ENV_NAME =
  "AUTH_SESSION_RS256_PRIVATE_KEY";
const AUTH_JWT_SECRET_ENV_NAME = "AUTH_JWT_SECRET";
const AUTH_JWT_RS256_PUBLIC_KEY_ENV_NAME = "AUTH_JWT_RS256_PUBLIC_KEY";
const AUTH_JWT_RS256_PRIVATE_KEY_ENV_NAME = "AUTH_JWT_RS256_PRIVATE_KEY";
const AUTH_JWT_TTL_SECONDS_ENV_NAME = "AUTH_JWT_TTL_SECONDS";
const AUTH_COOKIE_PARENT_DOMAIN_ENV_NAME = "AUTH_COOKIE_PARENT_DOMAIN";
const AUTH_COOKIE_ALLOW_LOCALHOST_ENV_NAME = "AUTH_COOKIE_ALLOW_LOCALHOST";

function decodePemNewlines(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, "\n");
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${AUTH_JWT_TTL_SECONDS_ENV_NAME} must be a positive integer`
    );
  }

  return parsed;
}

function getLogoutCookieConfig() {
  return {
    authCookieAllowLocalhost: isStrictTrue(
      getOptionalEnv(process.env, AUTH_COOKIE_ALLOW_LOCALHOST_ENV_NAME) ??
        "true"
    ),
    authCookieParentDomains: parseAuthCookieParentDomains(
      getOptionalEnv(process.env, AUTH_COOKIE_PARENT_DOMAIN_ENV_NAME)
    ),
    authCookiePreviewFallback: isVercelPreviewEnv(process.env),
    authJwtSecret: getOptionalEnv(process.env, AUTH_JWT_SECRET_ENV_NAME),
    authJwtTtlSeconds: parsePositiveInteger(
      getOptionalEnv(process.env, AUTH_JWT_TTL_SECONDS_ENV_NAME),
      60 * 60 * 24 * 7
    ),
    authSessionRs256PrivateKey: decodePemNewlines(
      getOptionalEnv(process.env, AUTH_JWT_RS256_PRIVATE_KEY_ENV_NAME) ??
        getOptionalEnv(process.env, AUTH_SESSION_RS256_PRIVATE_KEY_ENV_NAME)
    ),
    authSessionRs256PublicKey: decodePemNewlines(
      getOptionalEnv(process.env, AUTH_JWT_RS256_PUBLIC_KEY_ENV_NAME) ??
        getOptionalEnv(process.env, AUTH_SESSION_RS256_PUBLIC_KEY_ENV_NAME)
    ),
  };
}

export async function POST(request: Request) {
  const sessionCookieService = createAuthSessionCookieService({
    getConfig: getLogoutCookieConfig,
  });
  const response = new NextResponse(null, { status: 204 });

  response.cookies.set({
    name: WALLET_AUTH_SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieService.createClearedSessionCookieOptions(request),
  });

  return response;
}
