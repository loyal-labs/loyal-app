import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTokenHoldings } from "@/lib/solana/token-holdings/fetch-token-holdings";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

export function useTokenHoldings(walletAddress: string | null) {
  const [tokenHoldings, setTokenHoldings] = useState<TokenHolding[]>([]);
  const [isHoldingsLoading, setIsHoldingsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshTokenHoldings = useCallback(
    async (forceRefresh = false) => {
      if (!walletAddress) return;
      const fetchId = ++fetchIdRef.current;
      setIsHoldingsLoading(true);
      try {
        const holdings = await fetchTokenHoldings(walletAddress, forceRefresh);
        if (fetchId === fetchIdRef.current) {
          setTokenHoldings(holdings);
        }
      } catch (error) {
        console.error("Failed to fetch token holdings", error);
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsHoldingsLoading(false);
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
    }
  }, [walletAddress, refreshTokenHoldings]);

  return { tokenHoldings, isHoldingsLoading, refreshTokenHoldings };
}
