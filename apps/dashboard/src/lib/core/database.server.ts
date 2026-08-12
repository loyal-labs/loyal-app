import "server-only";

import { createNeonDb, type NeonDb } from "@loyal-labs/db-adapter-neon";
import * as schema from "@loyal-labs/db-core/schema";

import { serverEnv } from "@/lib/core/config/server";

let database: NeonDb<typeof schema> | null = null;

export function getDatabase(): NeonDb<typeof schema> {
  if (database) {
    return database;
  }

  database = createNeonDb({
    databaseUrl: serverEnv.databaseUrl,
    schema,
  });

  return database;
}
