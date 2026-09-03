"use client";

import type { SwapToken } from "@loyal-labs/wallet-core/types";
import { useCallback, useEffect, useState } from "react";

import {
  getCachedTrendingTokens,
  prefetchTrendingTokens,
  resetTokenSearchCacheForTests,
  searchTokens,
} from "@/lib/market/token-search.client";

/**
 * Trending tokens for the swap pickers. The non-hook fetching/caching logic
 * lives in `@/lib/market/token-search.client` so non-React callers share the
 * same cache; this module is the React binding.
 */
export async function fetchPopularTokens(): Promise<SwapToken[]> {
  // `TokenSearchResult` extends `SwapToken`, so the richer list satisfies the
  // original contract without a mapping pass.
  return prefetchTrendingTokens();
}

export function resetPopularTokensCacheForTests() {
  resetTokenSearchCacheForTests();
}

export function usePopularTokens(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  // Synchronously hydrate from cache so a warm picker paints on first render.
  const [tokens, setTokens] = useState<SwapToken[]>(
    getCachedTrendingTokens() ?? []
  );
  const [isLoading, setIsLoading] = useState(
    enabled && !getCachedTrendingTokens()
  );

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(!getCachedTrendingTokens());
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
      return (await searchTokens(query)).filter((t) => t.isVerified);
    } catch {
      return [];
    }
  }, []);

  return { tokens, isLoading, search };
}
