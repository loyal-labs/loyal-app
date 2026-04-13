import "server-only";

import { getOptionalEnv, getRequiredEnv, isStrictTrue } from "./shared";

const CLOUDFLARE_CDN_BASE_URL_ENV_KEYS = [
  "CLOUDFLARE_CDN_BASE_URL",
  "NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL",
  "CLOUDFLARE_R2_PUBLIC_DEV_URL",
  "NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_DEV_URL",
] as const;

const REQUIRED_R2_ENV_VARS = [
  "CLOUDFLARE_R2_ACCOUNT_ID",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_BUCKET_NAME",
] as const;

const TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM =
  "TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM";
const TELEGRAM_SUMMARY_PEER_OVERRIDE_TO = "TELEGRAM_SUMMARY_PEER_OVERRIDE_TO";

type TelegramSummaryPeerOverride = {
  fromPeerId: bigint;
  toPeerId: bigint;
};

const getCloudflareCdnBaseUrl = (): string | null => {
  for (const key of CLOUDFLARE_CDN_BASE_URL_ENV_KEYS) {
    const value = getOptionalEnv(key);
    if (value) {
      return value;
    }
  }

  return null;
};

const parseTelegramPeerId = (value: string, envName: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${envName} must be a valid integer peer ID`);
  }
};

const getTelegramSummaryPeerOverride =
  (): TelegramSummaryPeerOverride | null => {
    const fromValue = getOptionalEnv(TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM);
    const toValue = getOptionalEnv(TELEGRAM_SUMMARY_PEER_OVERRIDE_TO);

    if (!fromValue && !toValue) {
      return null;
    }

    if (!fromValue || !toValue) {
      throw new Error(
        `${TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM} and ${TELEGRAM_SUMMARY_PEER_OVERRIDE_TO} must both be set`
      );
    }

    return {
      fromPeerId: parseTelegramPeerId(
        fromValue,
        TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM
      ),
      toPeerId: parseTelegramPeerId(toValue, TELEGRAM_SUMMARY_PEER_OVERRIDE_TO),
    };
  };

export const serverEnv = {
  get databaseUrl(): string {
    return getRequiredEnv("DATABASE_URL");
  },
  get redpillApiKey(): string {
    return getRequiredEnv("REDPILL_AI_API_KEY");
  },
  get summaryAxModel(): string | undefined {
    return getOptionalEnv("SUMMARY_AX_MODEL");
  },
  get axSummaryModelDefault(): string {
    return (
      getOptionalEnv("AX_SUMMARY_MODEL_DEFAULT") ??
      getOptionalEnv("SUMMARY_AX_MODEL") ??
      "z-ai/glm-4.7"
    );
  },
  get axSummaryMaxAttempts(): number {
    const value = getOptionalEnv("AX_SUMMARY_MAX_ATTEMPTS");
    if (!value) {
      return 3;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("AX_SUMMARY_MAX_ATTEMPTS must be a positive integer");
    }

    return parsed;
  },
  get axSummaryExamplesVersion(): string {
    return getOptionalEnv("AX_SUMMARY_EXAMPLES_VERSION") ?? "v1";
  },
  get axSummaryEnableTelemetry(): boolean {
    const value = getOptionalEnv("AX_SUMMARY_ENABLE_TELEMETRY");
    if (value === undefined) {
      return true;
    }

    return isStrictTrue(value);
  },
  get jupiterApiKey(): string {
    return getRequiredEnv("JUPITER_API_KEY");
  },
  get birdeyeApiKey(): string {
    return getRequiredEnv("BIRDEYE_API_KEY");
  },
  get irysSolanaKey(): string {
    return getRequiredEnv("IRYS_SOLANA_KEY");
  },
  get messageEncryptionKey(): string | undefined {
    return getOptionalEnv("MESSAGE_ENCRYPTION_KEY");
  },
  get deploymentPrivateKey(): string {
    return getRequiredEnv("DEPLOYMENT_PK");
  },
  get askLoyalBotToken(): string {
    return getRequiredEnv("ASKLOYAL_TGBOT_KEY");
  },
  get telegramSetupSecret(): string {
    return getRequiredEnv("TELEGRAM_SETUP_SECRET");
  },
  get mixpanelToken(): string | undefined {
    return getOptionalEnv("NEXT_PUBLIC_MIXPANEL_TOKEN");
  },
  get cronSecret(): string {
    return getRequiredEnv("CRON_SECRET");
  },
  get privateMainnetRpcUrl(): string {
    return getRequiredEnv("PRIVATE_MAINNET_RPC_URL");
  },
  get telegramSummaryPeerOverride(): TelegramSummaryPeerOverride | null {
    return getTelegramSummaryPeerOverride();
  },
  get cloudflareCdnBaseUrl(): string | null {
    return getCloudflareCdnBaseUrl();
  },
  get cloudflareR2UploadPrefix(): string | undefined {
    return getOptionalEnv("CLOUDFLARE_R2_UPLOAD_PREFIX");
  },
  get cloudflareR2S3Endpoint(): string | undefined {
    return getOptionalEnv("CLOUDFLARE_R2_S3_ENDPOINT");
  },
  get cloudflareR2AccountId(): string {
    return getRequiredEnv("CLOUDFLARE_R2_ACCOUNT_ID");
  },
  get cloudflareR2AccessKeyId(): string {
    return getRequiredEnv("CLOUDFLARE_R2_ACCESS_KEY_ID");
  },
  get cloudflareR2SecretAccessKey(): string {
    return getRequiredEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  },
  get cloudflareR2BucketName(): string {
    return getRequiredEnv("CLOUDFLARE_R2_BUCKET_NAME");
  },
  get isCloudflareR2UploadConfigured(): boolean {
    return REQUIRED_R2_ENV_VARS.every((name) => Boolean(getOptionalEnv(name)));
  },
} as const;
