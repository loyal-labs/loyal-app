import { createNeonDb, type NeonDb } from "@loyal-labs/db-adapter-neon";
import * as schema from "@loyal-labs/db-core/schema";

type EnvRecord = Record<string, string | undefined>;

export type UserbotDb = NeonDb<typeof schema>;

function normalizeOptionalValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadDatabaseUrl(env: EnvRecord = process.env): string {
  const databaseUrl = normalizeOptionalValue(env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return databaseUrl;
}

export function createWorkerDatabase(databaseUrl: string): UserbotDb {
  return createNeonDb({
    databaseUrl,
    schema,
  });
}
