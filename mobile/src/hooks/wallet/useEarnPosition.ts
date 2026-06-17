import { useCallback, useEffect, useRef, useState } from "react";

import { fetchEarnState, type EarnPosition } from "@/lib/solana/earn/earn-api";

// Reads the wallet's current Earn position (balance + APY) from the backend
// read-model. Like useTokenHoldings, it takes a read-only wallet address and
// never signs — the lookup is unauthenticated by design so opening the Earn tab
// doesn't prompt for a Seed Vault approval.
export function useEarnPosition(walletAddress: string | null) {
  const [position, setPosition] = useState<EarnPosition | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshEarnPosition = useCallback(async () => {
    if (!walletAddress) {
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const state = await fetchEarnState(walletAddress);
      if (fetchId === fetchIdRef.current) {
        setPosition(state.position);
      }
    } catch (error) {
      console.error("Failed to fetch Earn position", error);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) {
      refreshEarnPosition();
    } else {
      setPosition(null);
    }
  }, [walletAddress, refreshEarnPosition]);

  return { position, isLoading, refreshEarnPosition };
}
