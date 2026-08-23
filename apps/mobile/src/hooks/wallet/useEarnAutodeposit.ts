import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEarnAutodepositState,
  type EarnAutodepositState,
} from "@/lib/solana/earn/earn-api";
import { subscribeEarnRealtime } from "@/features/earn-realtime/events";

// Reads the wallet's current Autodeposit state (threshold + on/off + the
// policy/delegation the floor/toggle/close calls need) from the read-only
// backend endpoint. Like useEarnPosition: wallet-address-keyed, never signs.
export function useEarnAutodeposit(walletAddress: string | null) {
  const [autodeposit, setAutodeposit] = useState<EarnAutodepositState | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshAutodeposit = useCallback(
    async (options?: {
      throwOnError?: boolean;
    }): Promise<EarnAutodepositState | null> => {
      if (!walletAddress) {
        return null;
      }
      const fetchId = ++fetchIdRef.current;
      setIsLoading(true);
      try {
        const state = await fetchEarnAutodepositState(walletAddress);
        if (fetchId === fetchIdRef.current) {
          setAutodeposit(state.autodeposit);
        } else if (options?.throwOnError) {
          throw new Error("Autodeposit refresh was superseded.");
        }
        return state.autodeposit;
      } catch (error) {
        console.error("Failed to fetch Autodeposit state", error);
        if (options?.throwOnError) {
          throw error;
        }
        return null;
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [walletAddress],
  );

  useEffect(() => {
    if (walletAddress) {
      refreshAutodeposit();
    } else {
      setAutodeposit(null);
      setHasLoaded(false);
    }
  }, [walletAddress, refreshAutodeposit]);

  useEffect(
    () =>
      subscribeEarnRealtime(async (refresh) => {
        if (refresh.earnState) await refreshAutodeposit({ throwOnError: true });
      }),
    [refreshAutodeposit],
  );

  return { autodeposit, isLoading, hasLoaded, refreshAutodeposit };
}
