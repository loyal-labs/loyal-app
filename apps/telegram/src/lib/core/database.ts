import { createNeonDb, type NeonDb } from "@loyal-labs/db-adapter-neon";
import * as schema from "@loyal-labs/db-core/schema";

import { serverEnv } from "./config/server";

let db: NeonDb<typeof schema> | null = null;

export const getDatabase = (): NeonDb<typeof schema> => {
  const databaseUrl = serverEnv.databaseUrl;

  if (db) return db;

  db = createNeonDb({ databaseUrl, schema });
  return db;
};
