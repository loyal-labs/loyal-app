import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEarnTransactions,
  type EarnTransactionItem,
} from "@/lib/solana/earn/earn-api";
import { mmkv } from "@/lib/storage";

// Earn transactions are cached to disk per wallet so a returning user sees their
// last-known history the instant the Earn activity tab opens, instead of a
// skeleton while the (slow) backend responds. The fetch still runs to refresh —
// classic stale-while-revalidate. Keyed by wallet so switching accounts never
// shows the wrong history.
const cacheKey = (walletAddress: string): string => `earn:txns:${walletAddress}`;

function readCachedEarnTransactions(
  walletAddress: string,
): EarnTransactionItem[] | null {
  const raw = mmkv.getString(cacheKey(walletAddress));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EarnTransactionItem[]) : null;
  } catch {
    return null;
  }
}

function writeCachedEarnTransactions(
  walletAddress: string,
  transactions: EarnTransactionItem[],
): void {
  mmkv.setString(cacheKey(walletAddress), JSON.stringify(transactions));
}

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
  // Flips true once we have a known state for the current wallet — either a disk
  // cache hit or the first network fetch settling. Lets the UI show a skeleton
  // only on a true cold load (no cache, fetch in flight) and never flash it on
  // background polls.
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      const res = await fetchEarnTransactions(walletAddress);
      if (fetchId === fetchIdRef.current) {
        setEarnTransactions(res.transactions);
        writeCachedEarnTransactions(walletAddress, res.transactions);
      }
    } catch (error) {
      // Keep whatever is already shown (cache or prior fetch) — a transient
      // failure must not blank a populated feed.
      console.warn("Failed to fetch Earn transactions", error);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      setEarnTransactions([]);
      setHasLoaded(false);
      return;
    }
    // Hydrate from disk synchronously before the fetch resolves. A cache hit
    // shows the last-known feed immediately (hasLoaded → no skeleton); a miss
    // resets to the cold-load skeleton until the first fetch returns.
    const cached = readCachedEarnTransactions(walletAddress);
    setEarnTransactions(cached ?? []);
    setHasLoaded(cached !== null);
    void refresh();
  }, [walletAddress, refresh]);

  return { earnTransactions, isLoading, hasLoaded, refresh };
}
