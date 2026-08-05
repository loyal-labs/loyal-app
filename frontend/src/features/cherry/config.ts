const DEFAULT_CHERRY_ISSUER = "https://chat.cherry.fun";
const DEFAULT_CHERRY_JWKS_URL = "https://chat.cherry.fun/.well-known/jwks.json";

export const CHERRY_MINIAPP_ID_ENV_NAME = "CHERRY_MINIAPP_ID";
export const CHERRY_MINIAPP_ORIGIN_ENV_NAME = "CHERRY_MINIAPP_ORIGIN";
export const CHERRY_MINIAPP_ISSUER_ENV_NAME = "CHERRY_MINIAPP_ISSUER";
export const CHERRY_MINIAPP_JWKS_URL_ENV_NAME = "CHERRY_MINIAPP_JWKS_URL";

type EnvSource = Record<string, string | undefined>;

export type CherryMiniAppConfig =
  | {
      mode: "disabled";
      reason: string;
    }
  | {
      mode: "enabled";
      appId: string;
      expectedOrigin: string;
      issuer: string;
      jwksUrl: string;
    };

function normalizeUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  if (url.username || url.password) {
    throw new Error(`${name} must not contain URL credentials`);
  }

  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS outside local development`);
  }

  return url.origin;
}

function normalizeEndpointUrl(value: string, name: string): string {
  const normalizedOrigin = normalizeUrl(value, name);
  const url = new URL(value);
  if (url.hash) {
    throw new Error(`${name} must not contain a URL fragment`);
  }
  return `${normalizedOrigin}${url.pathname}${url.search}`;
}

function normalizeLaunchUrl(value: string, name: string): string {
  const normalizedOrigin = normalizeUrl(value, name);
  const url = new URL(value);
  if (url.search || url.hash) {
    throw new Error(`${name} must not contain a query or fragment`);
  }

  return `${normalizedOrigin}${url.pathname === "/" ? "" : url.pathname}`;
}

export function createCherryMiniAppConfig(env: EnvSource): CherryMiniAppConfig {
  const appId = env[CHERRY_MINIAPP_ID_ENV_NAME]?.trim();
  const expectedOrigin = env[CHERRY_MINIAPP_ORIGIN_ENV_NAME]?.trim();

  if (!(appId && expectedOrigin)) {
    return {
      mode: "disabled",
      reason: `${CHERRY_MINIAPP_ID_ENV_NAME} and ${CHERRY_MINIAPP_ORIGIN_ENV_NAME} are required`,
    };
  }

  return {
    mode: "enabled",
    appId,
    expectedOrigin: normalizeLaunchUrl(
      expectedOrigin,
      CHERRY_MINIAPP_ORIGIN_ENV_NAME
    ),
    issuer: normalizeUrl(
      env[CHERRY_MINIAPP_ISSUER_ENV_NAME]?.trim() ?? DEFAULT_CHERRY_ISSUER,
      CHERRY_MINIAPP_ISSUER_ENV_NAME
    ),
    jwksUrl: normalizeEndpointUrl(
      env[CHERRY_MINIAPP_JWKS_URL_ENV_NAME]?.trim() ?? DEFAULT_CHERRY_JWKS_URL,
      CHERRY_MINIAPP_JWKS_URL_ENV_NAME
    ),
  };
}
