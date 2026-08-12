import "server-only";

import { privateTransferTokenCatalog } from "@loyal-labs/db-core/schema";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

import type { PrivateTransferTokenCatalogUpsert } from "../types";
import {
  getAssetsByMint,
  mapHeliusAssetToCatalogEntry,
  resolveMintMetadataFallback,
} from "./helius";

export async function buildTokenCatalogUpserts(
  mints: Iterable<string>
): Promise<PrivateTransferTokenCatalogUpsert[]> {
  const uniqueMints = Array.from(new Set(Array.from(mints).filter(Boolean)));
  if (uniqueMints.length === 0) {
    return [];
  }

  const heliusAssets = await getAssetsByMint(uniqueMints);
  const byMint = new Map(
    heliusAssets.map((asset) => [asset.id, mapHeliusAssetToCatalogEntry(asset)])
  );

  const entries: PrivateTransferTokenCatalogUpsert[] = [];
  for (const mint of uniqueMints) {
    const heliusEntry = byMint.get(mint);
    if (heliusEntry && heliusEntry.decimals !== null) {
      entries.push({
        decimals: heliusEntry.decimals,
        name: heliusEntry.name,
        priceUsd: heliusEntry.priceUsd,
        symbol: heliusEntry.symbol,
        tokenMint: heliusEntry.tokenMint,
      });
      continue;
    }

    const fallback = await resolveMintMetadataFallback(mint);
    entries.push({
      decimals: fallback.decimals,
      name: heliusEntry?.name ?? fallback.name,
      priceUsd: heliusEntry?.priceUsd ?? fallback.priceUsd,
      symbol: heliusEntry?.symbol ?? fallback.symbol,
      tokenMint: mint,
    });
  }

  return entries;
}

export async function upsertTokenCatalog(
  entries: PrivateTransferTokenCatalogUpsert[]
): Promise<number> {
  if (entries.length === 0) {
    return 0;
  }

  const db = getDatabase();
  await db
    .insert(privateTransferTokenCatalog)
    .values(
      entries.map((entry) => ({
        decimals: entry.decimals,
        lastPriceUsd: entry.priceUsd,
        name: entry.name,
        symbol: entry.symbol,
        tokenMint: entry.tokenMint,
      }))
    )
    .onConflictDoUpdate({
      target: privateTransferTokenCatalog.tokenMint,
      set: {
        decimals: sql`excluded.decimals`,
        lastPriceUsd: sql`excluded.last_price_usd`,
        name: sql`excluded.name`,
        symbol: sql`excluded.symbol`,
        updatedAt: sql`now()`,
      },
    });

  return entries.length;
}
