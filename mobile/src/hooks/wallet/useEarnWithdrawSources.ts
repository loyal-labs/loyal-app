import { useCallback, useRef, useState } from "react";

import {
  fetchEarnWithdrawSources,
  type EarnWithdrawSourceInfo,
} from "@/lib/solana/earn/earn-api";

// Lazily loads the wallet's Earn withdrawal sources (reserves + idle vault
// USDC) for the withdraw source picker. Unlike the always-on position/autodeposit
// hooks, this is fetched on demand (when the user opens withdraw) since most
// sessions never withdraw.
export function useEarnWithdrawSources(walletAddress: string | null) {
  const [sources, setSources] = useState<EarnWithdrawSourceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshSources = useCallback(async () => {
    if (!walletAddress) {
      setSources([]);
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const res = await fetchEarnWithdrawSources(walletAddress);
      if (fetchId === fetchIdRef.current) {
        setSources(res.sources);
      }
    } catch (error) {
      console.error("Failed to fetch Earn withdrawal sources", error);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [walletAddress]);

  return { sources, isLoading, refreshSources };
}
