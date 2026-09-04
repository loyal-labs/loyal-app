import "server-only";

import { createNeonDb, type NeonDb } from "@loyal-labs/db-adapter-neon";
import * as schema from "@loyal-labs/db-core/schema";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "./config/server";

let db: NeonDb<typeof schema> | null = null;

const LOCAL_APP_DATABASE_URL_ENV_NAME = "APP_LOCAL_DATABASE_URL";

export function getDatabase(): NeonDb<typeof schema> {
  if (db) {
    return db;
  }

  const localDatabaseUrl = process.env[LOCAL_APP_DATABASE_URL_ENV_NAME]?.trim();
  if (localDatabaseUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `${LOCAL_APP_DATABASE_URL_ENV_NAME} is development-only.`
      );
    }
    const localClient = postgres(localDatabaseUrl, { max: 1 });
    db = drizzlePostgres(localClient, { schema }) as unknown as NeonDb<
      typeof schema
    >;
    return db;
  }

  const serverEnv = getServerEnv();
  db = createNeonDb({
    databaseUrl: serverEnv.databaseUrl,
    schema,
  });

  return db;
}
