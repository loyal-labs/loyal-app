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
  const { publicKey, state } = useWallet();
  const isUnlocked = state === "unlocked";

  const [walletAddress, setWalletAddress] = useState<string | null>(
    isUnlocked ? publicKey : null,
  );
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
    if (!publicKey || !isUnlocked) {
      loadedForKeyRef.current = null;
      setWalletAddress(null);
      setIsLoading(false);
      return;
    }

    if (walletAddress !== publicKey) {
      setCachedWalletAddress(publicKey);
      setWalletAddress(publicKey);
    }

    const alreadyLoadedForCurrentKey = loadedForKeyRef.current === publicKey;
    const hasWalletAddressInState = walletAddress === publicKey;

    // Skip if already loaded for this key (unless retrying)
    if (
      alreadyLoadedForCurrentKey &&
      retryCount === 0 &&
      hasWalletAddressInState
    ) {
      return;
    }
    loadedForKeyRef.current = publicKey;

    void loadBalance(publicKey);
  }, [publicKey, isUnlocked, retryCount, walletAddress, loadBalance]);

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
