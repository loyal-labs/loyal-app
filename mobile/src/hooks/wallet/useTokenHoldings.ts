import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeToAtaChanges } from "@/lib/solana/wallet/ata-balance-subscription";
import {
  clearHoldingsCache,
  fetchTokenHoldings,
} from "@/lib/solana/token-holdings/fetch-token-holdings";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { HOLDINGS_REFRESH_DEBOUNCE_MS } from "@/lib/solana/wallet-cache";

// Lazy import — `@solana/spl-token` touches `Buffer` at top level and
// breaks fast refresh if eagerly imported from a hook file.
async function getSplToken() {
  return await import("@solana/spl-token");
}

type UseTokenHoldingsOptions = {
  /**
   * Called when any of the user's ATAs emits an on-chain balance
   * change. The hook has already invalidated its cache and scheduled
   * a refetch before firing this; the callback should kick whatever
   * cross-cutting refresh the screen wants (activity feed, SOL
   * balance card, etc.).
   */
  onAtaBalanceChange?: () => void;
};

export function useTokenHoldings(
  walletAddress: string | null,
  { onAtaBalanceChange }: UseTokenHoldingsOptions = {},
) {
  const [tokenHoldings, setTokenHoldings] = useState<TokenHolding[]>([]);
  const [isHoldingsLoading, setIsHoldingsLoading] = useState(false);
  const fetchIdRef = useRef(0);
  const ataRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const onAtaBalanceChangeRef = useRef(onAtaBalanceChange);
  onAtaBalanceChangeRef.current = onAtaBalanceChange;

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
    [walletAddress],
  );

  useEffect(() => {
    if (walletAddress) {
      refreshTokenHoldings(false);
    } else {
      setTokenHoldings([]);
    }
  }, [walletAddress, refreshTokenHoldings]);

  // Subscribe to per-ATA balance changes. `onLogs(walletPubkey)` does
  // NOT match incoming SPL transfers (the owner wallet isn't mentioned
  // in the Token-program instruction — only the dest ATA is), so we
  // have to subscribe directly to each ATA. On any change we invalidate
  // the holdings cache, refetch, and notify the parent so it can kick
  // activity/balance refetches too.
  const atasKey = tokenHoldings
    .map((h) => h.mint)
    .filter((mint) => mint !== "So11111111111111111111111111111111111111112")
    .sort()
    .join(",");

  useEffect(() => {
    if (!walletAddress || !atasKey) return;

    let cancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    const scheduleAtaRefresh = () => {
      clearHoldingsCache();
      if (ataRefreshTimerRef.current) {
        clearTimeout(ataRefreshTimerRef.current);
      }
      ataRefreshTimerRef.current = setTimeout(() => {
        ataRefreshTimerRef.current = null;
        if (cancelled) return;
        void refreshTokenHoldings(true);
        onAtaBalanceChangeRef.current?.();
      }, HOLDINGS_REFRESH_DEBOUNCE_MS);
    };

    void (async () => {
      try {
        const owner = new PublicKey(walletAddress);
        const mints = atasKey.split(",").filter(Boolean);
        const {
          getAssociatedTokenAddressSync,
          TOKEN_PROGRAM_ID,
          TOKEN_2022_PROGRAM_ID,
        } = await getSplToken();

        // Derive both standard and Token-2022 ATAs — cheap, and saves
        // us from having to track which program each mint uses.
        const ataSet = new Set<string>();
        const atas: PublicKey[] = [];
        for (const mint of mints) {
          try {
            const mintPk = new PublicKey(mint);
            for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
              const ata = getAssociatedTokenAddressSync(
                mintPk,
                owner,
                false,
                programId,
              );
              const key = ata.toBase58();
              if (!ataSet.has(key)) {
                ataSet.add(key);
                atas.push(ata);
              }
            }
          } catch {
            // Invalid mint string — skip.
          }
        }

        if (cancelled) return;

        unsubscribe = await subscribeToAtaChanges(atas, () => {
          if (cancelled) return;
          scheduleAtaRefresh();
        });
      } catch (error) {
        console.error("[ws/ata] Failed to set up ATA subscriptions", error);
      }
    })();

    return () => {
      cancelled = true;
      if (ataRefreshTimerRef.current) {
        clearTimeout(ataRefreshTimerRef.current);
        ataRefreshTimerRef.current = null;
      }
      if (unsubscribe) void unsubscribe();
    };
  }, [walletAddress, atasKey, refreshTokenHoldings]);

  return { tokenHoldings, isHoldingsLoading, refreshTokenHoldings };
}
