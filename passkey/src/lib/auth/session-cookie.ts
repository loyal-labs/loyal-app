import {
  AUTH_SESSION_COOKIE_NAME,
  createAuthSessionTokenClaims,
  mapAuthSessionTokenClaimsToUser,
  type AuthSessionUser,
} from "@loyal-labs/auth-core";

import type { PasskeyServerConfig } from "@/lib/core/config/types";
import { resolvePasskeyRequestContext } from "@/lib/passkeys/host-resolution";

import {
  issueAuthSessionToken,
  issueAuthSessionTokenRS256,
  verifyAuthSessionTokenMulti,
} from "./session-token";

export { AUTH_SESSION_COOKIE_NAME };
export const EMAIL_AUTH_SESSION_COOKIE_NAME = AUTH_SESSION_COOKIE_NAME;

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
  domain?: string;
};

export interface AuthSessionCookieService {
  issueSessionToken(user: AuthSessionUser): Promise<string>;
  readSessionFromRequest(request: Request): Promise<AuthSessionUser | null>;
  createSessionCookieOptions(request: Request): SessionCookieOptions;
  createClearedSessionCookieOptions(request: Request): SessionCookieOptions;
}

export type SessionCookieService = AuthSessionCookieService;

type SessionCookieServiceDependencies = {
  getConfig: () => PasskeyServerConfig;
};

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

function resolveCookieOptions(
  request: Request,
  config: PasskeyServerConfig,
  maxAge: number
): SessionCookieOptions {
  const context = resolvePasskeyRequestContext({
    requestUrl: request.url,
    headers: request.headers,
    options: {
      allowedParentDomain: config.allowedParentDomain,
      allowLocalhost: config.allowLocalhost,
      rpId: config.rpId,
    },
  });

  return {
    httpOnly: true,
    sameSite: "lax",
    secure: !context.isLocalhost,
    path: "/",
    maxAge,
    ...(context.isLocalhost ? {} : { domain: config.allowedParentDomain }),
  };
}

export function createAuthSessionCookieService(
  dependencies: SessionCookieServiceDependencies
): AuthSessionCookieService {
  return {
    async issueSessionToken(user: AuthSessionUser) {
      const config = dependencies.getConfig();
      const claims = createAuthSessionTokenClaims(user);

      if (config.authRs256PrivateKey) {
        return issueAuthSessionTokenRS256(
          claims,
          config.authRs256PrivateKey,
          config.authJwtTtlSeconds
        );
      }

      return issueAuthSessionToken(
        claims,
        config.authJwtSecret,
        config.authJwtTtlSeconds
      );
    },

    async readSessionFromRequest(request: Request) {
      const config = dependencies.getConfig();
      const cookies = parseCookieHeader(request.headers.get("cookie"));
      const token = cookies[AUTH_SESSION_COOKIE_NAME];

      if (!token) {
        return null;
      }

      try {
        const claims = await verifyAuthSessionTokenMulti(token, {
          rs256PublicKey: config.authRs256PublicKey,
          hs256Secret: config.authJwtSecret,
        });
        return mapAuthSessionTokenClaimsToUser(claims);
      } catch {
        return null;
      }
    },

    createSessionCookieOptions(request: Request) {
      const config = dependencies.getConfig();
      return resolveCookieOptions(request, config, config.authJwtTtlSeconds);
    },

    createClearedSessionCookieOptions(request: Request) {
      const config = dependencies.getConfig();
      return resolveCookieOptions(request, config, 0);
    },
  };
}

export const createSessionCookieService = createAuthSessionCookieService;
