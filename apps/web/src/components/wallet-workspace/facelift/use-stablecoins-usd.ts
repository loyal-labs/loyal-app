"use client";

import { useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { useWalletDesktopData } from "@/hooks/use-wallet-desktop-data";
import {
  getStablecoinMintSetForSolanaEnv,
  isStablecoinMint,
} from "@/lib/wallet/stablecoin-classification";

// Same stablecoin bucketing the sidebar's Stablecoins cell uses.
export function useStablecoinsUsd(): number {
  const publicEnv = usePublicEnv();
  const walletData = useWalletDesktopData({});
  const stablecoinMints = useMemo(
    () => getStablecoinMintSetForSolanaEnv(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  return useMemo(
    () =>
      walletData.positions
        .filter((position) =>
          isStablecoinMint(position.asset.mint, stablecoinMints)
        )
        .reduce((sum, position) => sum + (position.totalValueUsd ?? 0), 0),
    [walletData.positions, stablecoinMints]
  );
}
