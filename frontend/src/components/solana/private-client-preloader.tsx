"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import {
  clearFrontendPrivateClientMemoryCache,
  getFrontendPrivateClient,
  type FrontendPrivateClientSigner,
} from "@/lib/solana/private-client-cache";

export function PrivateClientPreloader({ enabled }: { enabled: boolean }) {
  const publicEnv = usePublicEnv();
  const wallet = useWallet();

  useEffect(() => {
    if (!wallet.connected) {
      clearFrontendPrivateClientMemoryCache();
      return;
    }

    if (!enabled) {
      return;
    }

    if (
      !wallet.publicKey ||
      !wallet.signTransaction ||
      !wallet.signAllTransactions ||
      !wallet.signMessage
    ) {
      return;
    }

    let cancelled = false;
    const signer = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
      signMessage: wallet.signMessage,
    } as FrontendPrivateClientSigner;

    void getFrontendPrivateClient({
      signer,
      solanaEnv: publicEnv.solanaEnv,
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.warn("Failed to preload private SDK client", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    publicEnv.solanaEnv,
    wallet.connected,
    wallet.publicKey,
    wallet.signAllTransactions,
    wallet.signMessage,
    wallet.signTransaction,
  ]);

  return null;
}
