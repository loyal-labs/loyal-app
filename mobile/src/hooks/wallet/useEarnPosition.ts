import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEarnHoldings,
  fetchEarnState,
  type EarnHoldingItem,
  type EarnPosition,
} from "@/lib/solana/earn/earn-api";

// Merges the live on-chain holdings total into the read-model position. The
// `/state` read-model (`currentAmountRaw`) lags the chain and omits non-idle
// venue holdings, so the web reads holdings live for its headline balance — we
// mirror that here, keeping the read-model's APY/principal/status but taking the
// balance from the live total. When the live read is unavailable (null), we keep
// the read-model value rather than zeroing a real balance.
function mergeLiveBalance(
  position: EarnPosition | null,
  liveTotalRaw: string | null,
): EarnPosition | null {
  if (liveTotalRaw === null || position === null) {
    return position;
  }
  return { ...position, currentAmountRaw: liveTotalRaw };
}

// Reads the wallet's current Earn position (balance + APY) from the backend
// read-model. Like useTokenHoldings, it takes a read-only wallet address and
// never signs — the lookup is unauthenticated by design so opening the Earn tab
// doesn't prompt for a Seed Vault approval.
export function useEarnPosition(walletAddress: string | null) {
  const [position, setPosition] = useState<EarnPosition | null>(null);
  // Live per-venue holdings (Kamino obligation(s) + idle USDC) — the same data
  // the web shows for its per-position breakdown. Exposed alongside `position`
  // so the positions sheet can render the live split instead of the stale DB
  // withdraw-sources read.
  const [holdings, setHoldings] = useState<EarnHoldingItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshEarnPosition = useCallback(async () => {
    if (!walletAddress) {
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      // Fetch both concurrently: `state` for APY/principal/status, `holdings`
      // for the authoritative live balance. A holdings failure must not drop the
      // position, so each settles independently.
      const [stateResult, holdingsResult] = await Promise.allSettled([
        fetchEarnState(walletAddress),
        fetchEarnHoldings(walletAddress),
      ]);
      if (fetchId !== fetchIdRef.current) {
        return;
      }
      if (stateResult.status === "rejected") {
        console.error("Failed to fetch Earn position", stateResult.reason);
        return;
      }
      let liveTotalRaw: string | null = null;
      if (holdingsResult.status === "fulfilled") {
        liveTotalRaw = holdingsResult.value.currentTotalAmountRaw;
        setHoldings(holdingsResult.value.holdings);
      } else {
        console.error("Failed to fetch Earn holdings", holdingsResult.reason);
      }
      setPosition(mergeLiveBalance(stateResult.value.position, liveTotalRaw));
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
      setHoldings([]);
    }
  }, [walletAddress, refreshEarnPosition]);

  return { position, holdings, isLoading, refreshEarnPosition };
}
