import "server-only";

import { createNeonDb, type NeonDb } from "@loyal-labs/db-adapter-neon";
import * as schema from "@loyal-labs/db-core/schema";

import { getServerEnv } from "./config/server";

let db: NeonDb<typeof schema> | null = null;

export function getDatabase(): NeonDb<typeof schema> {
  if (db) {
    return db;
  }

  const serverEnv = getServerEnv();
  db = createNeonDb({
    databaseUrl: serverEnv.databaseUrl,
    schema,
  });

  return db;
}
