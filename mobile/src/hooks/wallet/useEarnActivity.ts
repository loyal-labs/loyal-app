import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEarnTransactions,
  type EarnTransactionItem,
} from "@/lib/solana/earn/earn-api";

// Reads the wallet's Earn transaction history from the backend read-model for
// the Activity screen's Earn tab. Read-only by wallet address, like
// useEarnEarnings — opening Activity never prompts for a Seed Vault signature.
// If the endpoint is unavailable (e.g. not yet deployed) it degrades to an empty
// list rather than surfacing an error.
export function useEarnActivity(walletAddress: string | null) {
  const [earnTransactions, setEarnTransactions] = useState<
    EarnTransactionItem[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const res = await fetchEarnTransactions(walletAddress);
      if (fetchId === fetchIdRef.current) {
        setEarnTransactions(res.transactions);
      }
    } catch (error) {
      console.warn("Failed to fetch Earn transactions", error);
      if (fetchId === fetchIdRef.current) {
        setEarnTransactions([]);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) {
      refresh();
    } else {
      setEarnTransactions([]);
    }
  }, [walletAddress, refresh]);

  return { earnTransactions, isLoading, refresh };
}
