import { getRequiredEnv } from "./shared";

export const serverEnv = {
  get databaseUrl(): string {
    return getRequiredEnv("DATABASE_URL");
  },
  get yieldNeonDatabaseUrl(): string {
    return getRequiredEnv("NEON_DATABASE_URL");
  },
} as const;
