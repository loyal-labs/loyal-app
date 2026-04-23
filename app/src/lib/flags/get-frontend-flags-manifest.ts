import "server-only";

import { runtimeFlags } from "@loyal-labs/db-core/schema";
import { asc } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

export async function getFrontendFlagsManifest() {
  const db = getDatabase();
  const flags = await db.select().from(runtimeFlags).orderBy(asc(runtimeFlags.key));

  const generatedAt = new Date().toISOString();

  return {
    version: generatedAt,
    generatedAt,
    flags: flags.map((flag) => ({
      key: flag.key,
      enabled: flag.enabled,
      audience: flag.audience,
      targetEnvironments: flag.targetEnvironments,
    })),
  };
}
