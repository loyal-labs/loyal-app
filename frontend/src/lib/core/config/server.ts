import "server-only";

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ADDRESS } from "@loyal-labs/loyal-smart-accounts";
import { resolveSolanaEnv, type SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  isStrictTrue,
  getOptionalEnv,
  getRequiredEnv,
  type AppEnvironment,
  type EnvSource,
  resolveAppEnvironment,
} from "./shared";

export type { AppEnvironment } from "./shared";

const APP_ENVIRONMENT_ENV_NAME = "NEXT_PUBLIC_APP_ENVIRONMENT";
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";
const LOYAL_SMART_ACCOUNTS_PROGRAM_ID_ENV_NAME =
  "LOYAL_SMART_ACCOUNTS_PROGRAM_ID";
const AUTH_SESSION_RS256_PUBLIC_KEY_ENV_NAME =
  "AUTH_SESSION_RS256_PUBLIC_KEY";
const AUTH_SESSION_RS256_PRIVATE_KEY_ENV_NAME =
  "AUTH_SESSION_RS256_PRIVATE_KEY";
const AUTH_JWT_SECRET_ENV_NAME = "AUTH_JWT_SECRET";
const AUTH_JWT_RS256_PUBLIC_KEY_ENV_NAME = "AUTH_JWT_RS256_PUBLIC_KEY";
const AUTH_JWT_RS256_PRIVATE_KEY_ENV_NAME = "AUTH_JWT_RS256_PRIVATE_KEY";
const AUTH_JWT_TTL_SECONDS_ENV_NAME = "AUTH_JWT_TTL_SECONDS";
const AUTH_COOKIE_PARENT_DOMAIN_ENV_NAME = "GRID_ALLOWED_PARENT_DOMAIN";
const AUTH_COOKIE_ALLOW_LOCALHOST_ENV_NAME = "GRID_ALLOW_LOCALHOST";
const AUTH_APP_NAME_ENV_NAME = "GRID_APP_NAME";
const DEPLOYMENT_PRIVATE_KEY_ENV_NAME = "DEPLOYMENT_PK";

export type ChatRuntimeConfig = {
  apiKey: string;
  modelId: string | undefined;
};

export type LoyalSmartAccountsRuntimeConfig = {
  programId: string;
};

export type ServerEnv = {
  appEnvironment: AppEnvironment;
  chatRuntime: ChatRuntimeConfig;
  databaseUrl: string;
  gridAuthBaseUrl: string | undefined;
  authAppName: string;
  authCookieAllowLocalhost: boolean;
  authCookieParentDomain: string | undefined;
  authJwtSecret: string | undefined;
  authJwtTtlSeconds: number;
  authSessionRs256PrivateKey: string | undefined;
  authSessionRs256PublicKey: string | undefined;
  deploymentPrivateKey: string | undefined;
  mixpanelToken: string | undefined;
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
    throw new Error(`${AUTH_JWT_TTL_SECONDS_ENV_NAME} must be a positive integer`);
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

export function createServerEnv(env: EnvSource): ServerEnv {
  const solanaEnv = resolveSolanaEnv(getOptionalEnv(env, SOLANA_ENV_ENV_NAME));

  return {
    appEnvironment: resolveAppEnvironment(
      getOptionalEnv(env, APP_ENVIRONMENT_ENV_NAME)
    ),
    chatRuntime: createChatRuntimeConfig(env),
    databaseUrl: getRequiredEnv(env, "DATABASE_URL"),
    gridAuthBaseUrl: getOptionalEnv(env, "NEXT_PUBLIC_GRID_AUTH_BASE_URL"),
    authAppName: getOptionalEnv(env, AUTH_APP_NAME_ENV_NAME) ?? "askloyal",
    authCookieAllowLocalhost: isStrictTrue(
      getOptionalEnv(env, AUTH_COOKIE_ALLOW_LOCALHOST_ENV_NAME) ?? "true"
    ),
    authCookieParentDomain: getOptionalEnv(env, AUTH_COOKIE_PARENT_DOMAIN_ENV_NAME),
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
    mixpanelToken: getOptionalEnv(env, "NEXT_PUBLIC_MIXPANEL_TOKEN"),
    solanaEnv,
    loyalSmartAccounts: createLoyalSmartAccountsRuntimeConfig(env, solanaEnv),
  };
}

export function getServerEnv(): ServerEnv {
  return createServerEnv(process.env);
}
