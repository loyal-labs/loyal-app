"use client";

import {
  readClientCacheEntry,
  writeClientCache,
} from "@/lib/client-cache/client-cache";

export type TokenMarket = {
  mint: string;
  priceChange24hPercent: number | null;
};

export type TokenMarketsResponse = {
  markets: TokenMarket[];
};

const TOKEN_MARKETS_CACHE_VERSION = 1;
// CoinGecko market data is mainnet-token data regardless of the selected
// Solana cluster, so the persisted cache is intentionally env-independent.
const TOKEN_MARKETS_CACHE_SCOPE = "global";
// 24h price-change badges are cosmetic; minutes of staleness is invisible.
const TOKEN_MARKETS_TTL_MS = 15 * 60 * 1000;
const TOKEN_MARKETS_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

let cache = new Map<
  string,
  { expiresAt: number; value: TokenMarketsResponse }
>();
let inflight = new Map<string, Promise<TokenMarketsResponse>>();

function getTokenMarketsPersistKey(key: string) {
  return `loyal.tokenMarkets.v${TOKEN_MARKETS_CACHE_VERSION}:${key}`;
}

function isTokenMarketsResponse(data: unknown): data is TokenMarketsResponse {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const markets = (data as TokenMarketsResponse).markets;
  return (
    Array.isArray(markets) &&
    markets.every(
      (market) =>
        typeof market === "object" &&
        market !== null &&
        typeof market.mint === "string"
    )
  );
}

function readPersistedTokenMarkets(key: string) {
  return readClientCacheEntry<TokenMarketsResponse>({
    key: getTokenMarketsPersistKey(key),
    version: TOKEN_MARKETS_CACHE_VERSION,
    solanaEnv: TOKEN_MARKETS_CACHE_SCOPE,
    validate: isTokenMarketsResponse,
  });
}

export function normalizeTokenMarketMintsSignature(mints: string) {
  return mints
    .split(",")
    .map((mint) => mint.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

export async function fetchTokenMarkets(
  mints: string,
  options: { now?: number } = {}
): Promise<TokenMarketsResponse> {
  const key = normalizeTokenMarketMintsSignature(mints);
  if (!key) {
    return { markets: [] };
  }

  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const persisted = readPersistedTokenMarkets(key);
  if (persisted && now - persisted.savedAt < TOKEN_MARKETS_TTL_MS) {
    cache.set(key, {
      expiresAt: persisted.savedAt + TOKEN_MARKETS_TTL_MS,
      value: persisted.data,
    });
    return persisted.data;
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const url = new URL("/api/tokens/markets", window.location.origin);
    url.searchParams.set("mints", key);

    let response: Response;
    try {
      response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Markets request failed: ${response.status}`);
      }
    } catch (error) {
      // Fall back to day-old badges rather than dropping them entirely.
      if (persisted) {
        return persisted.data;
      }
      throw error;
    }

    const value = (await response.json()) as TokenMarketsResponse;
    cache.set(key, {
      expiresAt: Date.now() + TOKEN_MARKETS_TTL_MS,
      value,
    });
    writeClientCache({
      key: getTokenMarketsPersistKey(key),
      version: TOKEN_MARKETS_CACHE_VERSION,
      solanaEnv: TOKEN_MARKETS_CACHE_SCOPE,
      data: value,
      ttlMs: TOKEN_MARKETS_PERSIST_TTL_MS,
    });
    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, request);
  return request;
}

export function resetTokenMarketsCacheForTests() {
  cache = new Map();
  inflight = new Map();
}
