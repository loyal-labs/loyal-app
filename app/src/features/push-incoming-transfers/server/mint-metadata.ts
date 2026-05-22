import "server-only";

import { privateTransferTokenCatalog } from "@loyal-labs/db-core/schema";
import { inArray } from "drizzle-orm";

import {
  buildTokenCatalogUpserts,
  upsertTokenCatalog,
} from "@/features/private-transfer-analytics/server/token-catalog";
import { getDatabase } from "@/lib/core/database";

export type MintMetadata = { symbol: string; decimals: number };

/**
 * Look up token symbol + decimals for a set of mints, falling back to
 * the Helius asset API when the local catalog is missing entries. Newly
 * resolved mints are upserted into the catalog so subsequent webhook
 * deliveries hit the fast path.
 *
 * Extracted from the legacy polling sync so it can be reused by the
 * webhook handler without dragging in the rest of the file.
 */
export async function resolveMintMetadata(
  mints: Iterable<string>,
): Promise<Map<string, MintMetadata>> {
  const uniqueMints = Array.from(new Set(Array.from(mints).filter(Boolean)));
  if (uniqueMints.length === 0) return new Map();

  const db = getDatabase();
  const existing = await db
    .select({
      tokenMint: privateTransferTokenCatalog.tokenMint,
      decimals: privateTransferTokenCatalog.decimals,
      symbol: privateTransferTokenCatalog.symbol,
    })
    .from(privateTransferTokenCatalog)
    .where(inArray(privateTransferTokenCatalog.tokenMint, uniqueMints));

  const resolved = new Map<string, MintMetadata>();
  for (const row of existing) {
    resolved.set(row.tokenMint, {
      decimals: row.decimals ?? 0,
      symbol: row.symbol ?? row.tokenMint,
    });
  }

  const missing = uniqueMints.filter((mint) => !resolved.has(mint));
  if (missing.length > 0) {
    const entries = await buildTokenCatalogUpserts(missing);
    await upsertTokenCatalog(entries);
    for (const entry of entries) {
      resolved.set(entry.tokenMint, {
        decimals: entry.decimals ?? 0,
        symbol: entry.symbol,
      });
    }
  }

  return resolved;
}
