import type { TokenHolding } from "@/lib/solana/token-holdings/types";

type ShouldShowWalletTopUpOptions = {
  totalSolLamports: number;
  holdings: TokenHolding[];
  isLoading: boolean;
  networkLoading: boolean;
  walletError: string | null | undefined;
};

export function shouldShowWalletTopUp({
  totalSolLamports,
  holdings,
  isLoading,
  networkLoading,
  walletError,
}: ShouldShowWalletTopUpOptions): boolean {
  if (isLoading || networkLoading || !!walletError) {
    return false;
  }

  if (totalSolLamports > 0) {
    return false;
  }

  return !holdings.some((holding) => holding.balance > 0);
}
