import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

const SERVER_ENV_KEYS = [
  "DATABASE_URL",
  "REDPILL_AI_API_KEY",
  "JUPITER_API_KEY",
  "IRYS_SOLANA_KEY",
  "MESSAGE_ENCRYPTION_KEY",
  "DEPLOYMENT_PK",
  "ASKLOYAL_TGBOT_KEY",
  "TELEGRAM_SETUP_SECRET",
  "NEXT_PUBLIC_MIXPANEL_TOKEN",
  "CRON_SECRET",
  "TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM",
  "TELEGRAM_SUMMARY_PEER_OVERRIDE_TO",
  "CLOUDFLARE_CDN_BASE_URL",
  "NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL",
  "CLOUDFLARE_R2_PUBLIC_DEV_URL",
  "NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_DEV_URL",
  "CLOUDFLARE_R2_ACCOUNT_ID",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_BUCKET_NAME",
  "CLOUDFLARE_R2_S3_ENDPOINT",
  "CLOUDFLARE_R2_UPLOAD_PREFIX",
  "SUMMARY_AX_MODEL",
  "AX_SUMMARY_MODEL_DEFAULT",
  "AX_SUMMARY_MAX_ATTEMPTS",
  "AX_SUMMARY_EXAMPLES_VERSION",
  "AX_SUMMARY_ENABLE_TELEMETRY",
] as const;

function clearServerEnv(): void {
  for (const key of SERVER_ENV_KEYS) {
    delete process.env[key];
  }
}

let serverEnv: {
  databaseUrl: string;
  redpillApiKey: string;
  summaryAxModel: string | undefined;
  axSummaryModelDefault: string;
  axSummaryMaxAttempts: number;
  axSummaryExamplesVersion: string;
  axSummaryEnableTelemetry: boolean;
  jupiterApiKey: string;
  irysSolanaKey: string;
  messageEncryptionKey: string | undefined;
  deploymentPrivateKey: string;
  askLoyalBotToken: string;
  telegramSetupSecret: string;
  mixpanelToken: string | undefined;
  cronSecret: string;
  telegramSummaryPeerOverride: { fromPeerId: bigint; toPeerId: bigint } | null;
  cloudflareCdnBaseUrl: string | null;
  cloudflareR2UploadPrefix: string | undefined;
  cloudflareR2S3Endpoint: string | undefined;
  cloudflareR2AccountId: string;
  cloudflareR2AccessKeyId: string;
  cloudflareR2SecretAccessKey: string;
  cloudflareR2BucketName: string;
  isCloudflareR2UploadConfigured: boolean;
};

describe("server config", () => {
  beforeAll(async () => {
    const loadedModule = await import("../server");
    serverEnv = loadedModule.serverEnv;
  });

  beforeEach(() => {
    clearServerEnv();
  });

  afterEach(() => {
    clearServerEnv();
  });

  test("throws for missing required values", () => {
    expect(() => serverEnv.databaseUrl).toThrow("DATABASE_URL is not set");
    expect(() => serverEnv.telegramSetupSecret).toThrow(
      "TELEGRAM_SETUP_SECRET is not set"
    );
    expect(() => serverEnv.cronSecret).toThrow("CRON_SECRET is not set");
  });

  test("returns required values when present", () => {
    process.env.DATABASE_URL = "postgres://db";
    process.env.TELEGRAM_SETUP_SECRET = "secret";
    process.env.CRON_SECRET = "cron-secret";

    expect(serverEnv.databaseUrl).toBe("postgres://db");
    expect(serverEnv.telegramSetupSecret).toBe("secret");
    expect(serverEnv.cronSecret).toBe("cron-secret");
  });

  test("supports legacy and new Ax summary model envs", () => {
    process.env.SUMMARY_AX_MODEL = "legacy/model";
    expect(serverEnv.summaryAxModel).toBe("legacy/model");
    expect(serverEnv.axSummaryModelDefault).toBe("legacy/model");

    process.env.AX_SUMMARY_MODEL_DEFAULT = "new/model";
    expect(serverEnv.axSummaryModelDefault).toBe("new/model");
  });

  test("parses Ax summary attempts and telemetry envs", () => {
    process.env.AX_SUMMARY_MAX_ATTEMPTS = "5";
    process.env.AX_SUMMARY_ENABLE_TELEMETRY = "false";
    process.env.AX_SUMMARY_EXAMPLES_VERSION = "v2";

    expect(serverEnv.axSummaryMaxAttempts).toBe(5);
    expect(serverEnv.axSummaryEnableTelemetry).toBe(false);
    expect(serverEnv.axSummaryExamplesVersion).toBe("v2");
  });

  test("throws for invalid AX_SUMMARY_MAX_ATTEMPTS", () => {
    process.env.AX_SUMMARY_MAX_ATTEMPTS = "0";
    expect(() => serverEnv.axSummaryMaxAttempts).toThrow(
      "AX_SUMMARY_MAX_ATTEMPTS must be a positive integer"
    );
  });

  test("returns summary override when both env vars are set", () => {
    process.env.TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM = "4864680368";
    process.env.TELEGRAM_SUMMARY_PEER_OVERRIDE_TO = "-1002981429221";

    expect(serverEnv.telegramSummaryPeerOverride).toEqual({
      fromPeerId: BigInt("4864680368"),
      toPeerId: BigInt("-1002981429221"),
    });
  });

  test("throws when only one summary override env var is set", () => {
    process.env.TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM = "4864680368";

    expect(() => serverEnv.telegramSummaryPeerOverride).toThrow(
      "TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM and TELEGRAM_SUMMARY_PEER_OVERRIDE_TO must both be set"
    );
  });

  test("throws when summary override env vars are invalid peer IDs", () => {
    process.env.TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM = "invalid";
    process.env.TELEGRAM_SUMMARY_PEER_OVERRIDE_TO = "-1002981429221";

    expect(() => serverEnv.telegramSummaryPeerOverride).toThrow(
      "TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM must be a valid integer peer ID"
    );
  });

  test("selects CDN base URL in documented priority order", () => {
    process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_DEV_URL =
      "https://pub-last.r2.dev";
    process.env.CLOUDFLARE_R2_PUBLIC_DEV_URL = "https://pub-third.r2.dev";
    process.env.NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL =
      "https://cdn-second.example.com";
    process.env.CLOUDFLARE_CDN_BASE_URL = "https://cdn-first.example.com";

    expect(serverEnv.cloudflareCdnBaseUrl).toBe(
      "https://cdn-first.example.com"
    );
  });

  test("reports R2 config availability correctly", () => {
    expect(serverEnv.isCloudflareR2UploadConfigured).toBe(false);

    process.env.CLOUDFLARE_R2_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "key";
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret";
    process.env.CLOUDFLARE_R2_BUCKET_NAME = "bucket";

    expect(serverEnv.isCloudflareR2UploadConfigured).toBe(true);
  });
});
