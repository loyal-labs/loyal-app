import "server-only";

import {
  getOptionalEnv,
  getRequiredEnv,
  type AppEnvironment,
  type EnvSource,
  resolveAppEnvironment,
} from "./shared";

export type { AppEnvironment } from "./shared";

const APP_ENVIRONMENT_ENV_NAME = "NEXT_PUBLIC_APP_ENVIRONMENT";

export type ChatRuntimeConfig = {
  apiKey: string;
  modelId: string | undefined;
};

export type ServerEnv = {
  appEnvironment: AppEnvironment;
  chatRuntime: ChatRuntimeConfig;
  databaseUrl: string;
  gridAuthBaseUrl: string | undefined;
  authSessionRs256PublicKey: string | undefined;
  mixpanelToken: string | undefined;
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

export function createServerEnv(env: EnvSource): ServerEnv {
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
  };
}

export function getServerEnv(): ServerEnv {
  return createServerEnv(process.env);
}
