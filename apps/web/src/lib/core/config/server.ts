import "server-only";

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ADDRESS } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  isStrictTrue,
  isVercelPreviewEnv,
  getOptionalEnv,
  getRequiredEnv,
  parseAuthCookieParentDomains,
  type AppEnvironment,
  type EnvSource,
  resolveAppEnvironment,
} from "./shared";

export type { AppEnvironment } from "./shared";

const APP_ENVIRONMENT_ENV_NAME = "NEXT_PUBLIC_APP_ENVIRONMENT";
const LOYAL_SMART_ACCOUNTS_PROGRAM_ID_ENV_NAME =
  "LOYAL_SMART_ACCOUNTS_PROGRAM_ID";
const AUTH_SESSION_RS256_PUBLIC_KEY_ENV_NAME = "AUTH_SESSION_RS256_PUBLIC_KEY";
const AUTH_SESSION_RS256_PRIVATE_KEY_ENV_NAME =
  "AUTH_SESSION_RS256_PRIVATE_KEY";
const AUTH_JWT_SECRET_ENV_NAME = "AUTH_JWT_SECRET";
const AUTH_JWT_RS256_PUBLIC_KEY_ENV_NAME = "AUTH_JWT_RS256_PUBLIC_KEY";
const AUTH_JWT_RS256_PRIVATE_KEY_ENV_NAME = "AUTH_JWT_RS256_PRIVATE_KEY";
const AUTH_JWT_TTL_SECONDS_ENV_NAME = "AUTH_JWT_TTL_SECONDS";
const AUTH_COOKIE_PARENT_DOMAIN_ENV_NAME = "AUTH_COOKIE_PARENT_DOMAIN";
const AUTH_COOKIE_ALLOW_LOCALHOST_ENV_NAME = "AUTH_COOKIE_ALLOW_LOCALHOST";
const AUTH_APP_NAME_ENV_NAME = "AUTH_APP_NAME";
const DEPLOYMENT_PRIVATE_KEY_ENV_NAME = "DEPLOYMENT_PK";
const EARN_YIELD_ROUTER_PUBLIC_KEY_ENV_NAME = "EARN_YIELD_ROUTER_PUBLIC_KEY";
const SMART_ACCOUNT_SPONSOR_PRIVATE_KEY_ENV_NAME = "SMART_ACCOUNT_SPONSOR_PK";
const REALTIME_AUTH_SECRET_ENV_NAME = "REALTIME_AUTH_SECRET";
const REALTIME_EVENTS_URL_ENV_NAME = "REALTIME_EVENTS_URL";
const DEFAULT_REALTIME_EVENTS_URL =
  "https://loyal-yield-realtime.onrender.com/events";
const DEFAULT_LOCAL_REALTIME_EVENTS_URL = "http://127.0.0.1:10000/events";

export type ChatRuntimeConfig = {
  apiKey: string;
  modelId: string | undefined;
};

export type LoyalSmartAccountsRuntimeConfig = {
  programId: string;
};

export type EarnRealtimeRuntimeConfig = {
  authSecret: string | undefined;
  eventsUrl: string;
};

export type ServerEnv = {
  appEnvironment: AppEnvironment;
  chatRuntime: ChatRuntimeConfig;
  databaseUrl: string;
  authAppName: string;
  authCookieAllowLocalhost: boolean;
  authCookieParentDomains: readonly string[];
  authCookiePreviewFallback: boolean;
  authJwtSecret: string | undefined;
  authJwtTtlSeconds: number;
  authSessionRs256PrivateKey: string | undefined;
  authSessionRs256PublicKey: string | undefined;
  deploymentPrivateKey: string | undefined;
  earnYieldRouterPublicKey: string | undefined;
  earnRealtime: EarnRealtimeRuntimeConfig;
  mixpanelToken: string | undefined;
  smartAccountSponsorPrivateKey: string | undefined;
  solanaEnv: SolanaEnv;
  loyalSmartAccounts: LoyalSmartAccountsRuntimeConfig;
};

function createChatRuntimeConfig(env: EnvSource): ChatRuntimeConfig {
  return {
    apiKey: getRequiredEnv(env, "PHALA_API_KEY"),
    modelId: getOptionalEnv(env, "PHALA_MODEL_ID"),
  };
}

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

function createLoyalSmartAccountsRuntimeConfig(
  env: EnvSource,
  solanaEnv: SolanaEnv
): LoyalSmartAccountsRuntimeConfig {
  const envSpecificProgramId = getOptionalEnv(
    env,
    `${LOYAL_SMART_ACCOUNTS_PROGRAM_ID_ENV_NAME}_${solanaEnv.toUpperCase()}`
  );
  const candidateProgramId =
    envSpecificProgramId ??
    getOptionalEnv(env, LOYAL_SMART_ACCOUNTS_PROGRAM_ID_ENV_NAME) ??
    PROGRAM_ADDRESS;
  const normalizedProgramId = new PublicKey(candidateProgramId).toBase58();

  return {
    programId: normalizedProgramId,
  };
}

export function resolveLoyalSmartAccountsProgramIdFromEnv(
  env: EnvSource
): string {
  return createLoyalSmartAccountsRuntimeConfig(
    env,
    resolveLoyalWebSolanaEnvFromEnv(env)
  ).programId;
}

export function createServerEnv(env: EnvSource): ServerEnv {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(env);
  const appEnvironment = resolveAppEnvironment(
    getOptionalEnv(env, APP_ENVIRONMENT_ENV_NAME)
  );

  return {
    appEnvironment,
    chatRuntime: createChatRuntimeConfig(env),
    databaseUrl: getRequiredEnv(env, "DATABASE_URL"),
    authAppName: getOptionalEnv(env, AUTH_APP_NAME_ENV_NAME) ?? "askloyal",
    authCookieAllowLocalhost: isStrictTrue(
      getOptionalEnv(env, AUTH_COOKIE_ALLOW_LOCALHOST_ENV_NAME) ?? "true"
    ),
    authCookieParentDomains: parseAuthCookieParentDomains(
      getOptionalEnv(env, AUTH_COOKIE_PARENT_DOMAIN_ENV_NAME)
    ),
    authCookiePreviewFallback: isVercelPreviewEnv(env),
    authJwtSecret: getOptionalEnv(env, AUTH_JWT_SECRET_ENV_NAME),
    authJwtTtlSeconds: parsePositiveInteger(
      getOptionalEnv(env, AUTH_JWT_TTL_SECONDS_ENV_NAME),
      60 * 60 * 24 * 7
    ),
    authSessionRs256PrivateKey: decodePemNewlines(
      getOptionalEnv(env, AUTH_JWT_RS256_PRIVATE_KEY_ENV_NAME) ??
        getOptionalEnv(env, AUTH_SESSION_RS256_PRIVATE_KEY_ENV_NAME)
    ),
    authSessionRs256PublicKey: decodePemNewlines(
      getOptionalEnv(env, AUTH_JWT_RS256_PUBLIC_KEY_ENV_NAME) ??
        getOptionalEnv(env, AUTH_SESSION_RS256_PUBLIC_KEY_ENV_NAME)
    ),
    deploymentPrivateKey: getOptionalEnv(env, DEPLOYMENT_PRIVATE_KEY_ENV_NAME),
    earnYieldRouterPublicKey: getOptionalEnv(
      env,
      EARN_YIELD_ROUTER_PUBLIC_KEY_ENV_NAME
    ),
    earnRealtime: {
      authSecret: getOptionalEnv(env, REALTIME_AUTH_SECRET_ENV_NAME),
      eventsUrl:
        getOptionalEnv(env, REALTIME_EVENTS_URL_ENV_NAME) ??
        (appEnvironment === "local"
          ? DEFAULT_LOCAL_REALTIME_EVENTS_URL
          : DEFAULT_REALTIME_EVENTS_URL),
    },
    mixpanelToken: getOptionalEnv(env, "NEXT_PUBLIC_MIXPANEL_TOKEN"),
    smartAccountSponsorPrivateKey: getOptionalEnv(
      env,
      SMART_ACCOUNT_SPONSOR_PRIVATE_KEY_ENV_NAME
    ),
    solanaEnv,
    loyalSmartAccounts: createLoyalSmartAccountsRuntimeConfig(env, solanaEnv),
  };
}

export function getServerEnv(): ServerEnv {
  return createServerEnv(process.env);
}
