import type { SolanaWalletDataClient } from "@loyal-labs/solana-wallet";
import type { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";

export type TokenBalance = {
  symbol: string;
  balance: number;
  mint: string;
  decimals: number;
};

export function useWalletBalances(
  publicKey: PublicKey | null,
  client: SolanaWalletDataClient
) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) {
      setBalances([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const tokenBalances = (
        await client.getPortfolio(publicKey)
      ).positions.map((position) => ({
        symbol: position.asset.symbol,
        balance: position.totalBalance,
        mint: position.asset.mint,
        decimals: position.asset.decimals,
      }));

      setBalances(tokenBalances);
      setLoading(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch balances";
      setError(errorMessage);
      console.error("Error fetching wallet balances:", err);
      setLoading(false);
    }
  }, [client, publicKey]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  return {
    balances,
    loading,
    error,
    isConnected: Boolean(publicKey),
    refetch: fetchBalances,
  };
}
