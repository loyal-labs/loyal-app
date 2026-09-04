"use client";

import {
  readClientCacheEntry,
  writeClientCache,
} from "@/lib/client-cache/client-cache";

type TokenMarketRouteResponse = {
  market?: { priceUsd?: number | null } | null;
};

const TOKEN_MARKET_CACHE_VERSION = 1;
// CoinGecko market data is mainnet-token data regardless of the selected
// Solana cluster, so the persisted cache is intentionally env-independent.
const TOKEN_MARKET_CACHE_SCOPE = "global";
const TOKEN_MARKET_FRESH_MS = 5 * 60 * 1000;
const TOKEN_MARKET_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

let memoryCache = new Map<string, { expiresAt: number; priceUsd: number }>();
let inflight = new Map<string, Promise<number | null>>();

function getTokenMarketCacheKey(mint: string) {
  return `loyal.tokenMarket.v${TOKEN_MARKET_CACHE_VERSION}:${mint}`;
}

function isValidPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readPersistedEntry(mint: string) {
  return readClientCacheEntry<number>({
    key: getTokenMarketCacheKey(mint),
    version: TOKEN_MARKET_CACHE_VERSION,
    solanaEnv: TOKEN_MARKET_CACHE_SCOPE,
    validate: isValidPrice,
  });
}

/**
 * Returns the last known USD price for a mint without touching the network.
 * The value may be up to 24h stale; callers use it for instant paint while
 * `fetchTokenMarketPriceUsd` revalidates.
 */
export function readCachedTokenMarketPriceUsd(mint: string): number | null {
  const memory = memoryCache.get(mint);
  if (memory) {
    return memory.priceUsd;
  }

  return readPersistedEntry(mint)?.data ?? null;
}

export async function fetchTokenMarketPriceUsd(
  mint: string
): Promise<number | null> {
  const now = Date.now();
  const memory = memoryCache.get(mint);
  if (memory && memory.expiresAt > now) {
    return memory.priceUsd;
  }

  const persisted = readPersistedEntry(mint);
  if (persisted && now - persisted.savedAt < TOKEN_MARKET_FRESH_MS) {
    memoryCache.set(mint, {
      expiresAt: persisted.savedAt + TOKEN_MARKET_FRESH_MS,
      priceUsd: persisted.data,
    });
    return persisted.data;
  }

  const existing = inflight.get(mint);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    try {
      const response = await fetch(
        `/api/tokens/${encodeURIComponent(mint)}/market`
      );
      if (!response.ok) {
        return persisted?.data ?? null;
      }

      const payload = (await response.json()) as TokenMarketRouteResponse;
      const price = payload.market?.priceUsd;
      if (!isValidPrice(price)) {
        return persisted?.data ?? null;
      }

      memoryCache.set(mint, {
        expiresAt: Date.now() + TOKEN_MARKET_FRESH_MS,
        priceUsd: price,
      });
      writeClientCache({
        key: getTokenMarketCacheKey(mint),
        version: TOKEN_MARKET_CACHE_VERSION,
        solanaEnv: TOKEN_MARKET_CACHE_SCOPE,
        data: price,
        ttlMs: TOKEN_MARKET_PERSIST_TTL_MS,
      });
      return price;
    } catch {
      return persisted?.data ?? null;
    }
  })().finally(() => {
    inflight.delete(mint);
  });

  inflight.set(mint, request);
  return request;
}

export function resetTokenMarketCacheForTests() {
  memoryCache = new Map();
  inflight = new Map();
}
