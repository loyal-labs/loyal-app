import "server-only";

import {
  mapAuthSessionTokenClaimsToUser,
} from "@loyal-labs/auth-core";
import type { AuthSessionUser } from "@loyal-labs/auth-core";

import { getServerEnv } from "@/lib/core/config/server";
import { WALLET_AUTH_SESSION_COOKIE_NAME } from "@/features/identity/server/session-cookie";
import { verifyAuthSessionTokenMulti } from "@/features/identity/server/session-token";

export type AuthenticatedPrincipal = {
  provider: "solana";
  authMethod: "wallet";
  subjectAddress: string;
  walletAddress: string;
  smartAccountAddress: string;
  settingsPda: string;
};

type AuthGatewayErrorCode =
  | "unsupported_auth_method"
  | "invalid_wallet_principal";

export class AuthGatewayError extends Error {
  readonly code: AuthGatewayErrorCode;
  readonly status: number;

  constructor(args: {
    code: AuthGatewayErrorCode;
    message: string;
    status?: number;
  }) {
    super(args.message);
    this.name = "AuthGatewayError";
    this.code = args.code;
    this.status = args.status ?? 403;
  }
}

function extractCookieValue(
  cookieHeader: string,
  name: string
): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name && rest.length > 0) {
      return rest.join("=");
    }
  }
  return undefined;
}

async function verifySessionLocally(
  request: Request
): Promise<AuthenticatedPrincipal | null> {
  const { authJwtSecret, authSessionRs256PublicKey } = getServerEnv();
  if (!authSessionRs256PublicKey && !authJwtSecret) return null;

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const token = extractCookieValue(cookieHeader, WALLET_AUTH_SESSION_COOKIE_NAME);
  if (!token) return null;

  let payload;
  try {
    payload = await verifyAuthSessionTokenMulti(token, {
      rs256PublicKey: authSessionRs256PublicKey,
      hs256Secret: authJwtSecret,
    });
  } catch {
    return null;
  }

  return mapAuthSessionUserToAuthenticatedPrincipal(
    mapAuthSessionTokenClaimsToUser(payload)
  );
}

export function isAuthGatewayError(error: unknown): error is AuthGatewayError {
  return (
    error instanceof AuthGatewayError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "status" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { status?: unknown }).status === "number")
  );
}

export function mapAuthSessionUserToAuthenticatedPrincipal(
  session: AuthSessionUser
): AuthenticatedPrincipal {
  if (session.authMethod !== "wallet") {
    throw new AuthGatewayError({
      code: "unsupported_auth_method",
      message: "Wallet authentication is required to use chat.",
    });
  }

  if (session.provider && session.provider !== "solana") {
    throw new AuthGatewayError({
      code: "unsupported_auth_method",
      message: "Only Solana wallet sessions can use chat.",
    });
  }

  if (!session.walletAddress) {
    throw new AuthGatewayError({
      code: "invalid_wallet_principal",
      message: "Wallet sessions must include a verified wallet address.",
    });
  }

  if (session.subjectAddress !== session.walletAddress) {
    throw new AuthGatewayError({
      code: "invalid_wallet_principal",
      message:
        "Wallet sessions must use the same subject and wallet address for chat.",
    });
  }

  if (!session.smartAccountAddress || !session.settingsPda) {
    throw new AuthGatewayError({
      code: "invalid_wallet_principal",
      message:
        "Wallet sessions must include a provisioned smart account and settings PDA.",
    });
  }

  return {
    provider: "solana",
    authMethod: "wallet",
    subjectAddress: session.walletAddress,
    walletAddress: session.walletAddress,
    smartAccountAddress: session.smartAccountAddress,
    settingsPda: session.settingsPda,
  };
}

export async function resolveAuthenticatedPrincipalFromRequest(
  request: Request
): Promise<AuthenticatedPrincipal | null> {
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return null;
  }

  return verifySessionLocally(request);
}
