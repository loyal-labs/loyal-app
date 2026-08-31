import "server-only";

import { privateTransferTokenCatalog } from "@loyal-labs/db-core/schema";
import { Connection, PublicKey } from "@solana/web3.js";
import { inArray, sql } from "drizzle-orm";

import { serverEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";
import { fetchJson } from "@/lib/core/http";

export type MintMetadata = { symbol: string; decimals: number };

const HELIUS_ASSET_BATCH_LIMIT = 100;

type HeliusAsset = {
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
    };
  };
  id: string;
  token_info?: {
    decimals?: number;
    price_info?: {
      price_per_token?: number;
    };
    symbol?: string;
  };
};

type CatalogEntry = {
  decimals: number;
  name: string;
  priceUsd: string | null;
  symbol: string;
  tokenMint: string;
};

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

async function getAssetsByMint(mints: string[]): Promise<HeliusAsset[]> {
  const assets: HeliusAsset[] = [];
  for (let index = 0; index < mints.length; index += HELIUS_ASSET_BATCH_LIMIT) {
    const response = await fetchJson<{ result?: HeliusAsset[] } | HeliusAsset[]>(
      serverEnv.privateMainnetRpcUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "getAssetBatch",
          method: "getAssetBatch",
          params: {
            ids: mints.slice(index, index + HELIUS_ASSET_BATCH_LIMIT),
            displayOptions: { showFungible: true },
          },
        }),
      },
    );
    assets.push(...(Array.isArray(response) ? response : (response.result ?? [])));
  }
  return assets;
}

function mapHeliusAssetToCatalogEntry(
  asset: HeliusAsset,
): CatalogEntry | null {
  const decimals =
    typeof asset.token_info?.decimals === "number"
      ? asset.token_info.decimals
      : null;
  if (decimals === null) return null;

  const symbol =
    asset.token_info?.symbol?.trim() ||
    asset.content?.metadata?.symbol?.trim() ||
    shortMint(asset.id);
  const name = asset.content?.metadata?.name?.trim() || symbol;
  const priceUsd =
    typeof asset.token_info?.price_info?.price_per_token === "number"
      ? asset.token_info.price_info.price_per_token.toString()
      : null;

  return { decimals, name, priceUsd, symbol, tokenMint: asset.id };
}

async function resolveMintDecimalsFallback(mint: string): Promise<number> {
  const connection = new Connection(serverEnv.privateMainnetRpcUrl, {
    commitment: "confirmed",
  });
  const mintInfo = await connection.getParsedAccountInfo(
    new PublicKey(mint),
    "confirmed",
  );
  return (
    (mintInfo.value?.data as { parsed?: { info?: { decimals?: number } } })
      ?.parsed?.info?.decimals ?? 0
  );
}

async function upsertTokenCatalog(entries: CatalogEntry[]): Promise<void> {
  if (entries.length === 0) return;

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
      })),
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
}

/**
 * Look up token symbol + decimals for a set of mints, falling back to
 * the Helius asset API when the local catalog is missing entries. Newly
 * resolved mints are upserted into the catalog so subsequent webhook
 * deliveries hit the fast path.
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
    const heliusAssets = await getAssetsByMint(missing);
    const byMint = new Map(
      heliusAssets.map((asset) => [
        asset.id,
        mapHeliusAssetToCatalogEntry(asset),
      ]),
    );

    const entries: CatalogEntry[] = [];
    for (const mint of missing) {
      const heliusEntry = byMint.get(mint);
      if (heliusEntry) {
        entries.push(heliusEntry);
        continue;
      }
      const short = shortMint(mint);
      entries.push({
        decimals: await resolveMintDecimalsFallback(mint),
        name: short,
        priceUsd: null,
        symbol: short,
        tokenMint: mint,
      });
    }

    await upsertTokenCatalog(entries);
    for (const entry of entries) {
      resolved.set(entry.tokenMint, {
        decimals: entry.decimals,
        symbol: entry.symbol,
      });
    }
  }

  return resolved;
}
