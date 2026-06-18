import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEarnAutodepositState,
  type EarnAutodepositState,
} from "@/lib/solana/earn/earn-api";

// Reads the wallet's current Autodeposit state (threshold + on/off + the
// policy/delegation the floor/toggle/close calls need) from the read-only
// backend endpoint. Like useEarnPosition: wallet-address-keyed, never signs.
export function useEarnAutodeposit(walletAddress: string | null) {
  const [autodeposit, setAutodeposit] = useState<EarnAutodepositState | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const refreshAutodeposit = useCallback(async () => {
    if (!walletAddress) {
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const state = await fetchEarnAutodepositState(walletAddress);
      if (fetchId === fetchIdRef.current) {
        setAutodeposit(state.autodeposit);
      }
    } catch (error) {
      console.error("Failed to fetch Autodeposit state", error);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) {
      refreshAutodeposit();
    } else {
      setAutodeposit(null);
    }
  }, [walletAddress, refreshAutodeposit]);

  return { autodeposit, isLoading, refreshAutodeposit };
}
