import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import {
  getOptionalEnv,
  isStrictTrue,
  type AppEnvironment,
  type EnvSource,
  resolveAppEnvironment,
} from "./shared";

export type { AppEnvironment } from "./shared";

const APP_ENVIRONMENT_ENV_NAME = "NEXT_PUBLIC_APP_ENVIRONMENT";
const APP_URL_ENV_NAME = "NEXT_PUBLIC_APP_URL";
const CAP_SECRET_ENV_NAME = "CAP_SECRET";
const LOCAL_CAPTCHA_BYPASS_TOKEN = "local-bypass";
const FLAGS_MANIFEST_URL_ENV_NAME = "NEXT_PUBLIC_FLAGS_MANIFEST_URL";
const JUPITER_API_KEY_ENV_NAME = "NEXT_PUBLIC_JUPITER_API_KEY";
const SKILLS_ENABLED_ENV_NAME = "NEXT_PUBLIC_SKILLS_ENABLED";
const DEMO_RECIPE_ENV_NAME = "NEXT_PUBLIC_DEMO_RECIPE";
const USERCENTRICS_SETTINGS_ID_ENV_NAME =
  "NEXT_PUBLIC_USERCENTRICS_SETTINGS_ID";

export type CaptchaConfig =
  | { mode: "bypass"; verificationToken: string }
  | { mode: "widget" }
  | { mode: "misconfigured"; reason: string };

export type SwapConfig =
  | { mode: "enabled"; apiKey: string }
  | { mode: "disabled"; reason: string };

export type PublicEnv = {
  appEnvironment: AppEnvironment;
  loyalAppUrl: string;
  captcha: CaptchaConfig;
  flagsManifestUrl: string | undefined;
  solanaEnv: SolanaEnv;
  solanaRpcEndpoint: string;
  swap: SwapConfig;
  skillsEnabled: boolean;
  demoRecipeEnabled: boolean;
  mixpanelToken: string | undefined;
  mixpanelProxyPath: string;
  usercentricsSettingsId: string | undefined;
  gitBranch: string;
  gitCommitHash: string;
};

const DEFAULT_MIXPANEL_PROXY_PATH = "/ingest";

// Resolved server-side (root layout) and passed down via PublicEnvProvider.
// Local development follows the old Turnstile contract: authentication stays
// wired, but the captcha itself is optional. Deployed environments still fail
// closed when CAP_SECRET is missing.
function resolveCaptchaConfig(
  env: EnvSource,
  appEnvironment: AppEnvironment
): CaptchaConfig {
  if (appEnvironment === "local") {
    return {
      mode: "bypass",
      verificationToken: LOCAL_CAPTCHA_BYPASS_TOKEN,
    };
  }

  if (getOptionalEnv(env, CAP_SECRET_ENV_NAME)) {
    return { mode: "widget" };
  }

  return {
    mode: "misconfigured",
    reason: `The Cap captcha is enabled for ${appEnvironment}, but ${CAP_SECRET_ENV_NAME} is not set.`,
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

function resolveLoyalAppUrl(
  env: EnvSource,
  appEnvironment: AppEnvironment
): string {
  return (
    getOptionalEnv(env, APP_URL_ENV_NAME) ??
    (appEnvironment === "local"
      ? "http://localhost:3000/app"
      : "https://app.askloyal.com")
  );
}

export function createPublicEnv(env: EnvSource): PublicEnv {
  const appEnvironment = resolveAppEnvironment(
    getOptionalEnv(env, APP_ENVIRONMENT_ENV_NAME)
  );
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(env);

  return {
    appEnvironment,
    loyalAppUrl: resolveLoyalAppUrl(env, appEnvironment),
    captcha: resolveCaptchaConfig(env, appEnvironment),
    flagsManifestUrl: getOptionalEnv(env, FLAGS_MANIFEST_URL_ENV_NAME),
    solanaEnv,
    solanaRpcEndpoint: getFrontendSolanaEndpoints(solanaEnv).rpcEndpoint,
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
    usercentricsSettingsId: getOptionalEnv(
      env,
      USERCENTRICS_SETTINGS_ID_ENV_NAME
    ),
    gitBranch: getOptionalEnv(env, "NEXT_PUBLIC_GIT_BRANCH") ?? "unknown",
    gitCommitHash:
      getOptionalEnv(env, "NEXT_PUBLIC_GIT_COMMIT_HASH") ?? "unknown",
  };
}

export function getPublicEnv(): PublicEnv {
  return createPublicEnv(process.env);
}
