import {
  getSolanaEndpoints,
  resolveSolanaEnv,
  type SolanaEnv,
} from "@loyal-labs/solana-rpc";
import {
  getOptionalEnv,
  isStrictTrue,
  type AppEnvironment,
  type EnvSource,
  resolveAppEnvironment,
} from "./shared";

export type { AppEnvironment } from "./shared";

const LOCAL_TURNSTILE_BYPASS_TOKEN = "local-bypass";
const APP_ENVIRONMENT_ENV_NAME = "NEXT_PUBLIC_APP_ENVIRONMENT";
const TURNSTILE_SITE_KEY_ENV_NAME = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const GRID_AUTH_BASE_URL_ENV_NAME = "NEXT_PUBLIC_GRID_AUTH_BASE_URL";
const FLAGS_MANIFEST_URL_ENV_NAME = "NEXT_PUBLIC_FLAGS_MANIFEST_URL";
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";
const JUPITER_API_KEY_ENV_NAME = "NEXT_PUBLIC_JUPITER_API_KEY";
const SKILLS_ENABLED_ENV_NAME = "NEXT_PUBLIC_SKILLS_ENABLED";
const DEMO_RECIPE_ENV_NAME = "NEXT_PUBLIC_DEMO_RECIPE";

export type TurnstileConfig =
  | { mode: "bypass"; verificationToken: string }
  | { mode: "widget"; siteKey: string }
  | { mode: "misconfigured"; reason: string };

export type SwapConfig =
  | { mode: "enabled"; apiKey: string }
  | { mode: "disabled"; reason: string };

export type PublicEnv = {
  appEnvironment: AppEnvironment;
  turnstile: TurnstileConfig;
  gridAuthBaseUrl: string | undefined;
  flagsManifestUrl: string | undefined;
  solanaEnv: SolanaEnv;
  solanaRpcEndpoint: string;
  swap: SwapConfig;
  skillsEnabled: boolean;
  demoRecipeEnabled: boolean;
  mixpanelToken: string | undefined;
  mixpanelProxyPath: string;
  gitBranch: string;
  gitCommitHash: string;
};

const DEFAULT_MIXPANEL_PROXY_PATH = "/ingest";

function resolveTurnstileConfig(
  env: EnvSource,
  appEnvironment: AppEnvironment
): TurnstileConfig {
  if (appEnvironment === "local") {
    return {
      mode: "bypass",
      verificationToken: LOCAL_TURNSTILE_BYPASS_TOKEN,
    };
  }

  const siteKey = getOptionalEnv(env, TURNSTILE_SITE_KEY_ENV_NAME);
  if (siteKey) {
    return {
      mode: "widget",
      siteKey,
    };
  }

  return {
    mode: "misconfigured",
    reason: `Turnstile is enabled for ${appEnvironment}, but ${TURNSTILE_SITE_KEY_ENV_NAME} is not set.`,
  };
}

function resolveSwapConfig(env: EnvSource): SwapConfig {
  const apiKey = getOptionalEnv(env, JUPITER_API_KEY_ENV_NAME);
  if (apiKey) {
    return {
      mode: "enabled",
      apiKey,
    };
  }

  return {
    mode: "disabled",
    reason: `${JUPITER_API_KEY_ENV_NAME} is not set. Swap quotes are unavailable in this environment.`,
  };
}

export function createPublicEnv(env: EnvSource): PublicEnv {
  const appEnvironment = resolveAppEnvironment(
    getOptionalEnv(env, APP_ENVIRONMENT_ENV_NAME)
  );
  const solanaEnv = resolveSolanaEnv(getOptionalEnv(env, SOLANA_ENV_ENV_NAME));

  return {
    appEnvironment,
    turnstile: resolveTurnstileConfig(env, appEnvironment),
    gridAuthBaseUrl: getOptionalEnv(env, GRID_AUTH_BASE_URL_ENV_NAME),
    flagsManifestUrl: getOptionalEnv(env, FLAGS_MANIFEST_URL_ENV_NAME),
    solanaEnv,
    solanaRpcEndpoint: getSolanaEndpoints(solanaEnv).rpcEndpoint,
    swap: resolveSwapConfig(env),
    skillsEnabled: isStrictTrue(
      getOptionalEnv(env, SKILLS_ENABLED_ENV_NAME) ?? "true"
    ),
    demoRecipeEnabled: isStrictTrue(getOptionalEnv(env, DEMO_RECIPE_ENV_NAME)),
    mixpanelToken: getOptionalEnv(env, "NEXT_PUBLIC_MIXPANEL_TOKEN"),
    mixpanelProxyPath: (() => {
      const value = getOptionalEnv(env, "NEXT_PUBLIC_MIXPANEL_PROXY_PATH");
      if (!value) {
        return DEFAULT_MIXPANEL_PROXY_PATH;
      }

      return value.startsWith("/") ? value : `/${value}`;
    })(),
    gitBranch: getOptionalEnv(env, "NEXT_PUBLIC_GIT_BRANCH") ?? "unknown",
    gitCommitHash: getOptionalEnv(env, "NEXT_PUBLIC_GIT_COMMIT_HASH") ?? "unknown",
  };
}

export function getPublicEnv(): PublicEnv {
  return createPublicEnv(process.env);
}
