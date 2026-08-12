import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { getTelegramWalletDataClient } from "../solana-wallet-data-client";
import { HOLDINGS_REFRESH_DEBOUNCE_MS } from "../wallet-cache";
import { MOCK_BALANCE_LAMPORTS, USE_MOCK_DATA } from "../wallet-mock-data";

export function useWalletBalance(walletAddress: string | null): {
  solBalanceLamports: number | null;
  setSolBalanceLamports: React.Dispatch<React.SetStateAction<number | null>>;
  refreshBalance: (forceRefresh?: boolean) => Promise<void>;
} {
  const [solBalanceLamports, setSolBalanceLamports] = useState<number | null>(
    () => (USE_MOCK_DATA ? MOCK_BALANCE_LAMPORTS : null)
  );

  const refreshBalance = useCallback(
    async (_forceRefresh = false) => {
      if (!walletAddress) return;
      try {
        setSolBalanceLamports(
          await getTelegramWalletDataClient().getBalance(walletAddress)
        );
      } catch (error) {
        console.error("Failed to refresh wallet balance", error);
      }
    },
    [walletAddress]
  );

  // Subscribe to websocket balance updates so inbound funds appear in real time
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    if (!walletAddress) return;

    let isCancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        unsubscribe = await getTelegramWalletDataClient().subscribePortfolio(
          walletAddress,
          (snapshot) => {
            if (isCancelled) return;
            setSolBalanceLamports(snapshot.nativeBalanceLamports);
          },
          {
            debounceMs: HOLDINGS_REFRESH_DEBOUNCE_MS,
            emitInitial: true,
          }
        );
      } catch (error) {
        console.error("Failed to subscribe to wallet balance", error);
      }
    })();

    return () => {
      isCancelled = true;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, [walletAddress]);

  return { solBalanceLamports, setSolBalanceLamports, refreshBalance };
}
