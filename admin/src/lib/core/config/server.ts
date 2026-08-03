import "server-only";

import { getOptionalEnv, getRequiredEnv } from "./shared";

export const serverEnv = {
  get databaseUrl(): string {
    return getRequiredEnv("DATABASE_URL");
  },
  get yieldNeonDatabaseUrl(): string {
    return getRequiredEnv("NEON_DATABASE_URL");
  },
  get timescaleDatabaseUrl(): string {
    return getRequiredEnv("TIMESCALEDB_URL");
  },
  get libraryUploadToken(): string {
    return getRequiredEnv("LIBRARY_UPLOAD_TOKEN");
  },
  get appApiBaseUrl(): string {
    return getRequiredEnv("APP_API_BASE_URL");
  },
  get deploymentPublicKey(): string | undefined {
    return getOptionalEnv("DEPLOYMENT_PUBLIC_KEY");
  },
  get earnPolicySignerPublicKey(): string | undefined {
    return (
      getOptionalEnv("EARN_POLICY_SIGNER_PUBLIC_KEY") ??
      getOptionalEnv("EARN_YIELD_ROUTER_PUBLIC_KEY")
    );
  },
  get earnSettingsAuthorityPublicKey(): string | undefined {
    return getOptionalEnv("EARN_SETTINGS_AUTHORITY_PUBLIC_KEY");
  },
  get smartAccountSponsorPublicKey(): string | undefined {
    return getOptionalEnv("SMART_ACCOUNT_SPONSOR_PUBLIC_KEY");
  },
  get solanaMainnetRpcUrl(): string | undefined {
    return getOptionalEnv("SOLANA_MAINNET_RPC_URL");
  },
} as const;
