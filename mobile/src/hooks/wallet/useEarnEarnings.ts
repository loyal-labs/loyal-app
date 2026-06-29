import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEarnEarnings,
  type EarnEarningsResponse,
} from "@/lib/solana/earn/earn-api";

// Reads the wallet's Earn earnings (30-day daily bars + lifetime/since-deposit
// totals + current APY) from the backend read-model for the Earnings chart.
// Read-only by wallet address, like useEarnPosition — opening the Earn tab never
// prompts for a Seed Vault signature. `fetchedAtMs` anchors the live odometer:
// the response reflects earnings as of the server "now", so the chart accrues
// forward from when this resolved.
export function useEarnEarnings(walletAddress: string | null) {
  const [earnings, setEarnings] = useState<EarnEarningsResponse | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Flips true once a fetch settles (success OR error) so a failed read shows
  // the empty chart rather than a forever-pulsing skeleton.
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshEarnings = useCallback(async () => {
    if (!walletAddress) {
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const res = await fetchEarnEarnings(walletAddress);
      if (fetchId === fetchIdRef.current) {
        setEarnings(res);
        setFetchedAtMs(Date.now());
      }
    } catch (error) {
      console.error("Failed to fetch Earn earnings", error);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) {
      refreshEarnings();
    } else {
      setEarnings(null);
      setFetchedAtMs(null);
      setHasLoaded(false);
    }
  }, [walletAddress, refreshEarnings]);

  return { earnings, fetchedAtMs, isLoading, hasLoaded, refreshEarnings };
}
