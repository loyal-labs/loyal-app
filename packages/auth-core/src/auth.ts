import { authRoutePaths } from "./contracts";
import type { ApiOutcome, AuthClient, AuthRuntimeConfig } from "./types";

function normalizeAuthBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/") {
    return "";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function buildAuthUrl(authBaseUrl: string, endpoint: string): string {
  const normalizedBaseUrl = normalizeAuthBaseUrl(authBaseUrl);
  if (!normalizedBaseUrl) {
    return endpoint;
  }

  return `${normalizedBaseUrl}${endpoint}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export async function callAuthEndpoint(
  config: AuthRuntimeConfig,
  endpoint: string,
  init: RequestInit
): Promise<ApiOutcome> {
  const fetcher = config.fetch ?? fetch;
  const response = await fetcher(
    buildAuthUrl(config.authBaseUrl, endpoint),
    init
  );
  const body = await parseResponseBody(response);

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

export function createAuthClient(config: AuthRuntimeConfig): AuthClient {
  const getAuthSession = () =>
    callAuthEndpoint(config, authRoutePaths.getAuthSession, {
      method: "GET",
      credentials: "include",
    });
  const logoutAuthSession = () =>
    callAuthEndpoint(config, authRoutePaths.logoutAuthSession, {
      method: "POST",
      credentials: "include",
    });

  return {
    startEmailAuth: (payload) =>
      callAuthEndpoint(config, authRoutePaths.startEmailAuth, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      }),
    verifyEmailAuth: (payload) =>
      callAuthEndpoint(config, authRoutePaths.verifyEmailAuth, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      }),
    challengeWalletAuth: (payload) =>
      callAuthEndpoint(config, authRoutePaths.challengeWalletAuth, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      }),
    completeWalletAuth: (payload) =>
      callAuthEndpoint(config, authRoutePaths.completeWalletAuth, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      }),
    getAuthSession,
    logoutAuthSession,
  };
}
