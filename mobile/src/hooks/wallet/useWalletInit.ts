import { useCallback, useEffect, useRef, useState } from "react";

import { getWalletBalance } from "@/lib/solana/wallet/wallet-details";

import {
  getCachedWalletBalance,
  hasCachedWalletData,
  setCachedWalletAddress,
  setCachedWalletBalance,
  walletBalanceListeners,
} from "@/lib/solana/wallet-cache";
import { useWallet } from "@/lib/wallet/wallet-provider";

export function useWalletInit(): {
  walletAddress: string | null;
  isLoading: boolean;
  walletError: string | null;
  retryWalletInit: () => void;
} {
  const { publicKey } = useWallet();

  const [walletAddress, setWalletAddress] = useState<string | null>(publicKey);
  const [isLoading, setIsLoading] = useState(() => !hasCachedWalletData());
  const [walletError, setWalletError] = useState<string | null>(null);
  const loadedForKeyRef = useRef<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const loadBalance = useCallback(
    async (address: string) => {
      setIsLoading(true);
      setWalletError(null);

      try {
        setCachedWalletAddress(address);
        setWalletAddress(address);

        const cachedBalance = getCachedWalletBalance(address);

        if (cachedBalance !== null) {
          setIsLoading(false);
          void getWalletBalance().then((freshBalance) => {
            setCachedWalletBalance(address, freshBalance);
            walletBalanceListeners.forEach((listener) =>
              listener(freshBalance),
            );
          });
        } else {
          const balanceLamports = await getWalletBalance();
          setCachedWalletBalance(address, balanceLamports);
          walletBalanceListeners.forEach((listener) =>
            listener(balanceLamports),
          );
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Failed to load wallet balance", error);
        setWalletError("Something went wrong loading your wallet.");
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!publicKey) {
      setWalletAddress(null);
      setIsLoading(false);
      return;
    }

    // Skip if already loaded for this key (unless retrying)
    if (loadedForKeyRef.current === publicKey && retryCount === 0) return;
    loadedForKeyRef.current = publicKey;

    void loadBalance(publicKey);
  }, [publicKey, retryCount, loadBalance]);

  const retryWalletInit = useCallback(() => {
    loadedForKeyRef.current = null;
    setRetryCount((c) => c + 1);
  }, []);

  return {
    walletAddress,
    isLoading,
    walletError,
    retryWalletInit,
  };
}
