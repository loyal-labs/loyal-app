import "server-only";

import { getRequiredEnv } from "./shared";

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
} as const;
