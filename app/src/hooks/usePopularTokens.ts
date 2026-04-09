"use client";

import { useCallback, useEffect, useState } from "react";

const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

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

export type PopularToken = {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  priceUsd: number;
  mint: string;
  balance: number;
};

function toPopularToken(t: JupiterSearchResult): PopularToken {
  return {
    mint: t.id,
    symbol: t.symbol,
    name: t.name,
    icon: t.icon ?? "",
    decimals: t.decimals,
    priceUsd: t.usdPrice ?? 0,
    balance: 0,
  };
}

async function searchJupiterToken(
  query: string,
): Promise<JupiterSearchResult[]> {
  const res = await fetch(
    `${JUPITER_SEARCH_URL}?query=${encodeURIComponent(query)}&tags=verified&limit=10`,
  );
  if (!res.ok) return [];
  return res.json();
}

let popularCache: PopularToken[] | null = null;

async function fetchPopularTokens(): Promise<PopularToken[]> {
  if (popularCache) return popularCache;

  const results = await Promise.all(
    POPULAR_SYMBOLS.map(async (symbol) => {
      try {
        const tokens = await searchJupiterToken(symbol);
        const exact = tokens
          .filter(
            (t) =>
              t.symbol.toUpperCase() === symbol.toUpperCase() && t.isVerified,
          )
          .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
        return exact[0] ? toPopularToken(exact[0]) : null;
      } catch {
        return null;
      }
    }),
  );

  popularCache = results.filter((t): t is PopularToken => t !== null);
  return popularCache;
}

export function usePopularTokens() {
  const [tokens, setTokens] = useState<PopularToken[]>(popularCache ?? []);
  const [isLoading, setIsLoading] = useState(!popularCache);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  const search = useCallback(
    async (query: string): Promise<PopularToken[]> => {
      if (!query || query.length < 2) return [];
      try {
        const results = await searchJupiterToken(query);
        return results.filter((t) => t.isVerified).map(toPopularToken);
      } catch {
        return [];
      }
    },
    [],
  );

  return { tokens, isLoading, search };
}
