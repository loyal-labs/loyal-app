import { useCallback, useEffect, useState } from "react";

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

const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

export type PopularToken = {
  mint: string;
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  priceUsd: number | null;
};

type JupiterTokenResult = {
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number;
  usdPrice: number | null;
  isVerified: boolean;
  mcap: number | null;
};

function toPopularToken(t: JupiterTokenResult): PopularToken {
  return {
    mint: t.id,
    symbol: t.symbol,
    name: t.name,
    icon: t.icon ?? "",
    decimals: t.decimals,
    priceUsd:
      typeof t.usdPrice === "number" && Number.isFinite(t.usdPrice)
        ? t.usdPrice
        : null,
  };
}

async function searchJupiterTokens(
  query: string,
  limit = 10,
): Promise<JupiterTokenResult[]> {
  const res = await fetch(
    `${JUPITER_SEARCH_URL}?query=${encodeURIComponent(query)}&tags=verified&limit=${limit}`,
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
        const tokens = await searchJupiterTokens(symbol, 5);
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

export function usePopularTokens(): {
  tokens: PopularToken[];
  isLoading: boolean;
  searchTokens: (query: string) => Promise<PopularToken[]>;
} {
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

  const searchTokens = useCallback(
    async (query: string): Promise<PopularToken[]> => {
      if (!query || query.length < 2) return [];
      try {
        const results = await searchJupiterTokens(query);
        return results.filter((t) => t.isVerified).map(toPopularToken);
      } catch {
        return [];
      }
    },
    [],
  );

  return { tokens, isLoading, searchTokens };
}
