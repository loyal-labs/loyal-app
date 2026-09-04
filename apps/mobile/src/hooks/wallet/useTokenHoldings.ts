import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTokenHoldings } from "@/lib/solana/token-holdings/fetch-token-holdings";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

export function useTokenHoldings(walletAddress: string | null) {
  const [tokenHoldings, setTokenHoldings] = useState<TokenHolding[]>([]);
  const [isHoldingsLoading, setIsHoldingsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshTokenHoldings = useCallback(
    async (
      forceRefresh = false,
      options?: { throwOnError?: boolean },
    ): Promise<void> => {
      if (!walletAddress) return;
      const fetchId = ++fetchIdRef.current;
      setIsHoldingsLoading(true);
      try {
        const holdings = await fetchTokenHoldings(walletAddress, forceRefresh);
        if (fetchId === fetchIdRef.current) {
          setTokenHoldings(holdings);
        } else if (options?.throwOnError) {
          throw new Error("Token holdings refresh was superseded.");
        }
      } catch (error) {
        console.error("Failed to fetch token holdings", error);
        if (options?.throwOnError) {
          throw error;
        }
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsHoldingsLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [walletAddress],
  );

  useEffect(() => {
    if (walletAddress) {
      refreshTokenHoldings(false);
    } else {
      setTokenHoldings([]);
      setHasLoaded(false);
    }
  }, [walletAddress, refreshTokenHoldings]);

  return {
    tokenHoldings,
    isHoldingsLoading,
    hasLoaded,
    refreshTokenHoldings,
  };
}
