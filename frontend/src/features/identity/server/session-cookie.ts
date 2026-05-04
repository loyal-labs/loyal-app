import "server-only";

import {
  createAuthSessionTokenClaims,
  mapAuthSessionTokenClaimsToUser,
  type AuthSessionUser,
} from "@loyal-labs/auth-core";

import type { ServerEnv } from "@/lib/core/config/server";

import {
  issueAuthSessionToken,
  issueAuthSessionTokenRS256,
  type AuthSessionTokenClaims,
  verifyAuthSessionTokenMulti,
} from "./session-token";

export const WALLET_AUTH_SESSION_COOKIE_NAME = "loyal_wallet_session";
export const SESSION_REFRESH_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
  domain?: string;
};

export type WalletSessionMetadata = {
  expiresAt: string;
  refreshAfter: string;
};

type SessionCookieServiceDependencies = {
  getConfig: () => Pick<
    ServerEnv,
    | "authCookieAllowLocalhost"
    | "authCookieParentDomain"
    | "authJwtSecret"
    | "authJwtTtlSeconds"
    | "authSessionRs256PrivateKey"
    | "authSessionRs256PublicKey"
  >;
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.$/, "").toLowerCase();
}

function getPrimaryHeaderValue(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (!value) {
    return null;
  }

  const primary = value.split(",")[0]?.trim();
  return primary && primary.length > 0 ? primary : null;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name || rest.length === 0) {
      return acc;
    }

    acc[name] = rest.join("=");
    return acc;
  }, {});
}

function toIsoStringFromUnixSeconds(value: number): string {
  return new Date(value * 1000).toISOString();
}

function toRefreshAfterIsoString(iat: number): string {
  return new Date(iat * 1000 + SESSION_REFRESH_MIN_AGE_MS).toISOString();
}

function resolveCookieOptions(
  request: Request,
  config: ReturnType<SessionCookieServiceDependencies["getConfig"]>,
  maxAge: number
): SessionCookieOptions {
  const fallbackUrl = new URL(request.url);
  const hostHeader =
    getPrimaryHeaderValue(request.headers, "x-forwarded-host") ??
    getPrimaryHeaderValue(request.headers, "host") ??
    fallbackUrl.host;
  const protocol =
    getPrimaryHeaderValue(request.headers, "x-forwarded-proto") ??
    fallbackUrl.protocol.replace(/:$/, "");
  const hostname = normalizeHostname(new URL(`${protocol}://${hostHeader}`).hostname);

  if (hostname === "localhost") {
    if (!config.authCookieAllowLocalhost) {
      throw new Error("Localhost is not allowed for auth session cookies");
    }

    return {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge,
    };
  }

  const allowedParentDomain = normalizeHostname(
    config.authCookieParentDomain ?? ""
  );
  if (!allowedParentDomain) {
    throw new Error("AUTH_COOKIE_PARENT_DOMAIN is not set");
  }

  if (
    hostname !== allowedParentDomain &&
    !hostname.endsWith(`.${allowedParentDomain}`)
  ) {
    throw new Error(`Host "${hostname}" is not allowed for auth session cookies`);
  }

  return {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge,
    domain: allowedParentDomain,
  };
}

export function createAuthSessionCookieService(
  dependencies: SessionCookieServiceDependencies
) {
  async function readSessionClaimsFromRequest(request: Request) {
    const config = dependencies.getConfig();
    const token = parseCookieHeader(request.headers.get("cookie"))[
      WALLET_AUTH_SESSION_COOKIE_NAME
    ];

    if (!token) {
      return null;
    }

    try {
      return await verifyAuthSessionTokenMulti(token, {
        rs256PublicKey: config.authSessionRs256PublicKey,
        hs256Secret: config.authJwtSecret,
      });
    } catch {
      return null;
    }
  }

  return {
    async issueSessionToken(user: AuthSessionUser) {
      const config = dependencies.getConfig();
      const claims = createAuthSessionTokenClaims(user);

      if (config.authSessionRs256PrivateKey) {
        return issueAuthSessionTokenRS256(
          claims,
          config.authSessionRs256PrivateKey,
          config.authJwtTtlSeconds
        );
      }

      if (config.authJwtSecret) {
        return issueAuthSessionToken(
          claims,
          config.authJwtSecret,
          config.authJwtTtlSeconds
        );
      }

      throw new Error(
        "Wallet auth session signing is not configured. Set AUTH_JWT_SECRET or AUTH_JWT_RS256_PRIVATE_KEY."
      );
    },

    getSessionMetadata(claims: Pick<AuthSessionTokenClaims, "iat" | "exp">) {
      if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
        throw new Error("Wallet session is missing iat/exp claims");
      }

      return {
        expiresAt: toIsoStringFromUnixSeconds(claims.exp),
        refreshAfter: toRefreshAfterIsoString(claims.iat),
      } satisfies WalletSessionMetadata;
    },

    readSessionClaimsFromRequest,

    async readSessionFromRequest(request: Request) {
      const claims = await readSessionClaimsFromRequest(request);
      if (!claims) {
        return null;
      }

      return mapAuthSessionTokenClaimsToUser(claims);
    },

    shouldRefreshSessionToken(
      claims: Pick<AuthSessionTokenClaims, "authMethod" | "iat">,
      now = new Date()
    ) {
      if (claims.authMethod !== "wallet") {
        return false;
      }

      if (typeof claims.iat !== "number") {
        return false;
      }

      return now.getTime() - claims.iat * 1000 >= SESSION_REFRESH_MIN_AGE_MS;
    },

    createSessionCookieOptions(request: Request) {
      return resolveCookieOptions(
        request,
        dependencies.getConfig(),
        dependencies.getConfig().authJwtTtlSeconds
      );
    },

    createClearedSessionCookieOptions(request: Request) {
      return resolveCookieOptions(request, dependencies.getConfig(), 0);
    },
  };
}
