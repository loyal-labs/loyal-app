import "server-only";

import { neon } from "@neondatabase/serverless";

import { serverEnv } from "@/lib/core/config/server";

let yieldNeonSql: ReturnType<typeof neon> | null = null;

export function getYieldNeonSql(): ReturnType<typeof neon> {
  if (yieldNeonSql) {
    return yieldNeonSql;
  }

  yieldNeonSql = neon(serverEnv.yieldNeonDatabaseUrl);
  return yieldNeonSql;
}
