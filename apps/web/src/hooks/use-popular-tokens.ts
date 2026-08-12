"use client";

import type { SwapToken } from "@loyal-labs/wallet-core/types";
import { useCallback, useEffect, useState } from "react";

import {
  readClientCacheEntry,
  writeClientCache,
} from "@/lib/client-cache/client-cache";

const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

const POPULAR_TOKENS_CACHE_KEY = "loyal.popularTokens.v1";
const POPULAR_TOKENS_CACHE_VERSION = 1;
// Jupiter's verified-token registry is mainnet data regardless of the
// selected Solana cluster, so the persisted cache is env-independent.
const POPULAR_TOKENS_CACHE_SCOPE = "global";
// Token identity (mint/symbol/icon/decimals) is effectively immutable; the
// price field is only indicative in pickers (quotes come from the Jupiter
// quote API), so serving a stale list is safe.
const POPULAR_TOKENS_FRESH_MS = 60 * 60 * 1000;
const POPULAR_TOKENS_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

const POPULAR_SYMBOLS = [
  "USDC",
  "USDT",
  "JUP",
  "BONK",
  "RAY",
  "WIF",
  "PYTH",
  "JTO",
  "ORCA",
  "RENDER",
];

type JupiterSearchResult = {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string | null;
  usdPrice: number | null;
  isVerified: boolean;
  mcap: number | null;
};

function toSwapToken(t: JupiterSearchResult): SwapToken {
  return {
    mint: t.id,
    symbol: t.symbol,
    icon: t.icon ?? "",
    price: t.usdPrice ?? 0,
    balance: 0,
  };
}

async function searchJupiterToken(
  query: string
): Promise<JupiterSearchResult[]> {
  const res = await fetch(
    `${JUPITER_SEARCH_URL}?query=${encodeURIComponent(
      query
    )}&tags=verified&limit=10`
  );
  if (!res.ok) return [];
  return res.json();
}

function isSwapTokenArray(data: unknown): data is SwapToken[] {
  return (
    Array.isArray(data) &&
    data.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as SwapToken).mint === "string" &&
        typeof (t as SwapToken).symbol === "string" &&
        typeof (t as SwapToken).icon === "string" &&
        typeof (t as SwapToken).price === "number" &&
        typeof (t as SwapToken).balance === "number"
    )
  );
}

function readPersistedPopularTokens() {
  return readClientCacheEntry<SwapToken[]>({
    key: POPULAR_TOKENS_CACHE_KEY,
    version: POPULAR_TOKENS_CACHE_VERSION,
    solanaEnv: POPULAR_TOKENS_CACHE_SCOPE,
    validate: isSwapTokenArray,
  });
}

let popularCache: SwapToken[] | null = null;
let popularInflight: Promise<SwapToken[]> | null = null;

function loadPopularTokensFromNetwork(): Promise<SwapToken[]> {
  if (popularInflight) return popularInflight;

  popularInflight = Promise.all(
    POPULAR_SYMBOLS.map(async (symbol) => {
      try {
        const tokens = await searchJupiterToken(symbol);
        // Pick exact symbol match with highest mcap
        const exact = tokens
          .filter(
            (t) =>
              t.symbol.toUpperCase() === symbol.toUpperCase() && t.isVerified
          )
          .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
        return exact[0] ? toSwapToken(exact[0]) : null;
      } catch {
        return null;
      }
    })
  )
    .then((results) => {
      popularCache = results.filter((t): t is SwapToken => t !== null);
      // Only persist complete lists so a partial outage never pins a
      // degraded picker for the full TTL.
      if (popularCache.length === POPULAR_SYMBOLS.length) {
        writeClientCache({
          key: POPULAR_TOKENS_CACHE_KEY,
          version: POPULAR_TOKENS_CACHE_VERSION,
          solanaEnv: POPULAR_TOKENS_CACHE_SCOPE,
          data: popularCache,
          ttlMs: POPULAR_TOKENS_PERSIST_TTL_MS,
        });
      }
      return popularCache;
    })
    .finally(() => {
      popularInflight = null;
    });

  return popularInflight;
}

export async function fetchPopularTokens(): Promise<SwapToken[]> {
  if (popularCache) return popularCache;
  if (popularInflight) return popularInflight;

  const persisted = readPersistedPopularTokens();
  if (persisted) {
    popularCache = persisted.data;
    if (Date.now() - persisted.savedAt >= POPULAR_TOKENS_FRESH_MS) {
      // Stale but usable: serve instantly and revalidate in the background
      // for the next consumer.
      void loadPopularTokensFromNetwork().catch(() => {});
    }
    return popularCache;
  }

  return loadPopularTokensFromNetwork();
}

export function resetPopularTokensCacheForTests() {
  popularCache = null;
  popularInflight = null;
}

export function usePopularTokens(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [tokens, setTokens] = useState<SwapToken[]>(popularCache ?? []);
  const [isLoading, setIsLoading] = useState(enabled && !popularCache);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(!popularCache);
    void fetchPopularTokens()
      .then((result) => {
        if (!cancelled) setTokens(result);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const search = useCallback(async (query: string): Promise<SwapToken[]> => {
    if (!query || query.length < 2) return [];
    try {
      const results = await searchJupiterToken(query);
      return results.filter((t) => t.isVerified).map(toSwapToken);
    } catch {
      return [];
    }
  }, []);

  return { tokens, isLoading, search };
}
