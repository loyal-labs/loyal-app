import { resolveSolanaEnv, type SolanaEnv } from "@loyal-labs/solana-rpc";

import {
  type AppEnvironment,
  isStrictTrue,
  normalizeOptionalValue,
  resolveAppEnvironment,
} from "./shared";

export type PublicSolanaEnv = SolanaEnv;
const DEFAULT_MIXPANEL_PROXY_PATH = "/ingest";

export const publicEnv = {
  get appEnvironment(): AppEnvironment {
    return resolveAppEnvironment(process.env.NEXT_PUBLIC_APP_ENVIRONMENT);
  },
  get serverHost(): string | undefined {
    return normalizeOptionalValue(process.env.NEXT_PUBLIC_SERVER_HOST);
  },
  get telegramBotId(): string {
    return (
      normalizeOptionalValue(process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID) ?? ""
    );
  },
  get solanaEnv(): PublicSolanaEnv {
    return resolveSolanaEnv(
      normalizeOptionalValue(process.env.NEXT_PUBLIC_SOLANA_ENV)
    );
  },
  get gasPublicKey(): string | undefined {
    return normalizeOptionalValue(process.env.NEXT_PUBLIC_GAS_PUBLIC_KEY);
  },
  get useMockSummaries(): boolean {
    return isStrictTrue(
      normalizeOptionalValue(process.env.NEXT_PUBLIC_USE_MOCK_SUMMARIES)
    );
  },
  get mixpanelToken(): string | undefined {
    return normalizeOptionalValue(process.env.NEXT_PUBLIC_MIXPANEL_TOKEN);
  },
  get mixpanelProxyPath(): string {
    const value = normalizeOptionalValue(
      process.env.NEXT_PUBLIC_MIXPANEL_PROXY_PATH
    );

    if (!value) {
      return DEFAULT_MIXPANEL_PROXY_PATH;
    }

    return value.startsWith("/") ? value : `/${value}`;
  },
  get gitBranch(): string {
    return (
      normalizeOptionalValue(process.env.NEXT_PUBLIC_GIT_BRANCH) ?? "unknown"
    );
  },
  get gitCommitHash(): string {
    return (
      normalizeOptionalValue(process.env.NEXT_PUBLIC_GIT_COMMIT_HASH) ??
      "unknown"
    );
  },
} as const;
