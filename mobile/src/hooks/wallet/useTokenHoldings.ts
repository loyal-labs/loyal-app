import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTokenHoldings } from "@/lib/solana/token-holdings/fetch-token-holdings";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

export function useTokenHoldings(walletAddress: string | null) {
  // Intentionally NOT passing the wallet signer here. Reading shielded
  // balances is done read-only (enumerateDepositsByUser + a generated-keypair
  // read client). Passing the user's signer would build a TEE-authed PER
  // client whose getAuthToken signs a message — on Seeker that triggers a
  // Seed Vault hardware approval on every wallet view. Signing belongs to
  // explicit shield/unshield actions, not passive balance display.
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
    [walletAddress]
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
