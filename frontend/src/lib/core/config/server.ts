import "server-only";

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ADDRESS } from "@loyal-labs/loyal-smart-accounts";
import { resolveSolanaEnv, type SolanaEnv } from "@loyal-labs/solana-rpc";
import {
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
  authSessionRs256PublicKey: string | undefined;
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
    authSessionRs256PublicKey: decodePemNewlines(
      getOptionalEnv(env, "AUTH_SESSION_RS256_PUBLIC_KEY")
    ),
    mixpanelToken: getOptionalEnv(env, "NEXT_PUBLIC_MIXPANEL_TOKEN"),
    solanaEnv,
    loyalSmartAccounts: createLoyalSmartAccountsRuntimeConfig(env, solanaEnv),
  };
}

export function getServerEnv(): ServerEnv {
  return createServerEnv(process.env);
}
