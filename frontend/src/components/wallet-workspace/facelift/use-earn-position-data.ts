"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  isActiveEarnPosition,
  useActiveEarnPosition,
  type ActiveEarnPosition,
} from "@/hooks/use-active-earn-position";
import { useSmartAccountSidebarData } from "@/hooks/use-smart-account-sidebar-data";
import {
  earnAutodepositConfigFromLoadedState,
  getVisibleEarnAutodepositScheduledSweeps,
  rawTokenAmountToNumber,
  type LoadedEarnAutodepositConfig,
  type LoadedEarnAutodepositScheduledSweep,
} from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";

export type EarnPositionData = {
  autodepositConfig: LoadedEarnAutodepositConfig | null;
  earnBalanceUsd: number;
  hasPosition: boolean;
  hasResolvedPosition: boolean;
  position: ActiveEarnPosition | null;
  scheduledSweeps: LoadedEarnAutodepositScheduledSweep[];
  settingsPda: string | null | undefined;
  walletAddress: string | null;
};

// Composes the same standalone hooks the old workspace monolith wires up, so
// the redesigned panes read identical data with zero new business logic.
export function useEarnPositionData(): EarnPositionData {
  const publicEnv = usePublicEnv();
  const { connection } = useConnection();
  const wallet = useWallet();
  const { user } = useAuthSession();
  const walletAddress =
    user?.walletAddress ?? wallet.publicKey?.toBase58() ?? null;

  const smartAccountData = useSmartAccountSidebarData();
  const settingsPda = smartAccountData.overview?.settingsPda;

  const { hasResolved, position } = useActiveEarnPosition({
    connection,
    earnPolicy: smartAccountData.earnPolicy,
    enabled: Boolean(settingsPda && walletAddress),
    programId: smartAccountData.overview?.programId,
    settingsPda,
    solanaEnv: publicEnv.solanaEnv,
    walletAddress,
  });

  const hasPosition = isActiveEarnPosition(position);
  const earnBalanceUsd =
    hasPosition && position
      ? rawTokenAmountToNumber(position.currentTotalAmountRaw, 6)
      : 0;

  const autodepositConfig = useMemo(
    () => earnAutodepositConfigFromLoadedState(smartAccountData.earnAutodeposit),
    [smartAccountData.earnAutodeposit]
  );
  // ponytail: walletBalance caps not wired yet — null reproduces the existing
  // "balance not loaded" path (threshold-only filtering) of the old workspace.
  const scheduledSweeps = useMemo(
    () =>
      autodepositConfig
        ? getVisibleEarnAutodepositScheduledSweeps({
            scheduledSweeps: autodepositConfig.scheduledSweeps ?? [],
            walletBalanceFloorRaw: null,
            walletBalanceRaw: null,
          })
        : [],
    [autodepositConfig]
  );

  return {
    autodepositConfig,
    earnBalanceUsd,
    hasPosition,
    hasResolvedPosition: hasResolved,
    position,
    scheduledSweeps,
    settingsPda,
    walletAddress,
  };
}
