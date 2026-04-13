import { useCallback, useEffect, useRef, useState } from "react";

import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import {
  fetchTokenDetailMarket,
  type MobileTokenDetailResponse,
} from "@/services/api";
import type { Transaction } from "@/types/wallet";

import { buildTokenDetailViewModel, type TokenDetailViewModel } from "./view-model";

type UseTokenDetailInput = {
  mint: string;
  holdings: TokenHolding[];
  transactions: Transaction[];
};

type UseTokenDetailResult = {
  viewModel: TokenDetailViewModel;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useTokenDetail({
  mint,
  holdings,
  transactions,
}: UseTokenDetailInput): UseTokenDetailResult {
  const [market, setMarket] = useState<MobileTokenDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const reload = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const detail = await fetchTokenDetailMarket(mint);
      if (fetchId === fetchIdRef.current) {
        setMarket(detail);
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch token detail");
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [mint]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    viewModel: buildTokenDetailViewModel({
      mint,
      holdings,
      transactions,
      market,
    }),
    loading,
    error,
    reload,
  };
}
