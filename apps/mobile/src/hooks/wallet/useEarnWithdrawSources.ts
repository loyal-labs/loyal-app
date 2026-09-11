import { useCallback, useEffect, useRef, useState } from "react";

import { env } from "@/config/env";

import {
  fetchEarnWithdrawSources,
  type EarnWithdrawSourceInfo,
} from "@/lib/solana/earn/earn-api";

// Lazily loads the wallet's Earn withdrawal sources (reserves + idle vault
// USDC) for the withdraw source picker. Unlike the always-on position/autodeposit
// hooks, this is fetched on demand (when the user opens withdraw) since most
// sessions never withdraw.
export function useEarnWithdrawSources(
  walletAddress: string | null,
  lifecycleKey = "",
  enabled = true
) {
  const [sources, setSources] = useState<EarnWithdrawSourceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);
  const scope = `${env.solanaEnv}:${walletAddress}:${lifecycleKey}:${enabled}`;
  const scopeRef = useRef(scope);
  const changed = scopeRef.current !== scope;
  if (changed) {
    scopeRef.current = scope;
    ++fetchIdRef.current;
  }
  useEffect(() => {
    setSources([]);
    setIsLoading(false);
    const requests = fetchIdRef;
    return () => {
      ++requests.current;
    };
  }, [scope]);

  const refreshSources = useCallback(
    async (options?: { throwOnError?: boolean }) => {
      if (!walletAddress || !enabled || scopeRef.current !== scope) {
        setSources([]);
        return;
      }
      const fetchId = ++fetchIdRef.current;
      setIsLoading(true);
      try {
        const res = await fetchEarnWithdrawSources(walletAddress);
        if (fetchId === fetchIdRef.current && scopeRef.current === scope) {
          setSources(res.sources);
        } else if (options?.throwOnError) {
          throw new Error("Earn withdrawal sources refresh was superseded.");
        }
      } catch (error) {
        console.error("Failed to fetch Earn withdrawal sources", error);
        if (options?.throwOnError) {
          throw error;
        }
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [walletAddress, scope, enabled]
  );

  return {
    sources: changed || !enabled ? [] : sources,
    isLoading: changed ? false : isLoading,
    refreshSources,
  };
}
