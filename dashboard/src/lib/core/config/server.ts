import { getRequiredEnv } from "./shared";

export const serverEnv = {
  get yieldNeonDatabaseUrl(): string {
    return getRequiredEnv("NEON_DATABASE_URL");
  },
} as const;
