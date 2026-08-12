"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMainAccountUsdcBalance } from "@/components/wallet-workspace/facelift/earn-actions-support";
import {
  useEarnActions,
  type EarnActions,
  type EarnAutodepositConfigView,
  type EarnAutodepositOverride,
} from "@/components/wallet-workspace/facelift/use-earn-actions";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { createBrowserLifecycleTracker } from "@/features/observability/client";
import {
  isActiveEarnPosition,
  useActiveEarnPosition,
  type ActiveEarnPosition,
} from "@/hooks/use-active-earn-position";
import {
  useSmartAccountSidebarData,
  type SmartAccountRefreshCommitContext,
} from "@/hooks/use-smart-account-sidebar-data";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";
import {
  earnAutodepositConfigFromLoadedState,
  getVisibleEarnAutodepositScheduledSweeps,
  rawTokenAmountToNumber,
  type LoadedEarnAutodepositScheduledSweep,
} from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";

export type { EarnAutodepositConfigView };

export type EarnPositionData = {
  actions: EarnActions;
  autodepositConfig: EarnAutodepositConfigView | null;
  autodepositToggleError: string | null;
  earnBalanceUsd: number;
  hasPosition: boolean;
  hasResolvedPosition: boolean;
  position: ActiveEarnPosition | null;
  scheduledSweeps: LoadedEarnAutodepositScheduledSweep[];
  settingsPda: string | null | undefined;
  toggleAutodeposit: () => Promise<void>;
  walletAddress: string | null;
};

// Composes the same standalone hooks the old workspace monolith wires up, so
// the redesigned panes read identical data — plus the Earn mutation actions,
// which need this exact smart-account/position instance pair.
export function useEarnPositionData(): EarnPositionData {
  const publicEnv = usePublicEnv();
  const { connection } = useConnection();
  const wallet = useWallet();
  const { user } = useAuthSession();
  const walletAddress =
    user?.walletAddress ?? wallet.publicKey?.toBase58() ?? null;

  // Wallet USDC ATA read (the deposit funding balance); its refresh doubles as
  // the smart-account hook's onAfterTx, mirroring the monolith's
  // refreshMainAccountBalances wiring.
  const trackedKaminoUsdcMint = useMemo(
    () => resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  const mainUsdc = useMainAccountUsdcBalance({
    connection,
    mint: trackedKaminoUsdcMint,
    walletAddress,
  });
  const refreshMainUsdc = mainUsdc.refresh;
  const handleAfterTx = useCallback(
    (context: SmartAccountRefreshCommitContext) =>
      refreshMainUsdc(context.isCurrent),
    [refreshMainUsdc]
  );
  const smartAccountData = useSmartAccountSidebarData({
    onAfterTx: handleAfterTx,
  });
  const settingsPda = smartAccountData.overview?.settingsPda;

  const isPositionFetchEnabled = Boolean(settingsPda && walletAddress);
  const {
    hasResolved,
    position,
    refresh: refreshPosition,
    setPosition,
    suppressSubscriptionRefreshThroughSlot,
  } = useActiveEarnPosition({
    connection,
    earnPolicy: smartAccountData.earnPolicy,
    enabled: isPositionFetchEnabled,
    programId: smartAccountData.overview?.programId,
    settingsPda,
    solanaEnv: publicEnv.solanaEnv,
    walletAddress,
  });
  // hasResolved reads stale-true for a frame right after the fetch enables:
  // the hook only clears it in a useEffect, i.e. after that frame paints.
  // Track the enabled transition synchronously so consumers never see
  // "resolved" for inputs the hook hasn't reacted to yet (the zero-state
  // pane would flash during boot otherwise).
  const previousFetchEnabledRef = useRef(isPositionFetchEnabled);
  useEffect(() => {
    previousFetchEnabledRef.current = isPositionFetchEnabled;
  });
  const hasResolvedPosition =
    hasResolved &&
    !(isPositionFetchEnabled && !previousFetchEnabledRef.current);

  const hasPosition = isActiveEarnPosition(position);
  const earnBalanceUsd =
    hasPosition && position
      ? rawTokenAmountToNumber(position.currentTotalAmountRaw, 6)
      : 0;

  const loadedAutodepositConfig = useMemo(
    () =>
      earnAutodepositConfigFromLoadedState(smartAccountData.earnAutodeposit),
    [smartAccountData.earnAutodeposit]
  );

  // Optimistic overlay shared by the toggle and the mutation actions:
  // { config } overrides the loaded state ({ config: null } force-clears it
  // after a close), and fresh loaded state wins once its request settles.
  const [autodepositOverride, setAutodepositOverride] =
    useState<EarnAutodepositOverride>(null);
  const [autodepositToggleError, setAutodepositToggleError] = useState<
    string | null
  >(null);
  const toggleInFlightRef = useRef(false);

  // Fresh loaded state wins over the overlay — but not while the request is
  // still in flight (a background refresh mid-flight would snap the knob back).
  useEffect(() => {
    if (!toggleInFlightRef.current) {
      setAutodepositOverride(null);
    }
  }, [loadedAutodepositConfig]);

  const autodepositConfig: EarnAutodepositConfigView | null =
    autodepositOverride ? autodepositOverride.config : loadedAutodepositConfig;

  const executeToggle = smartAccountData.executeEarnAutodepositToggle;
  const toggleAutodeposit = useCallback(async () => {
    const config = autodepositConfig;
    if (!config) {
      return;
    }
    if (config.state !== "created" && config.state !== "paused") {
      return;
    }
    if (
      config.policyAccount.length === 0 ||
      config.recurringDelegation.length === 0
    ) {
      setAutodepositToggleError("Autodeposit account metadata is missing.");
      return;
    }

    const nextActive = config.state === "paused";
    const tracker = createBrowserLifecycleTracker({
      flowName: "earn.autodeposit.configuration",
      flowVariant: nextActive ? "resume" : "pause",
    });
    tracker.start("intent");
    tracker.observe("backend_confirm", { persistenceState: "not_started" });
    setAutodepositToggleError(null);
    toggleInFlightRef.current = true;
    setAutodepositOverride({
      config: {
        ...config,
        scheduledSweeps: [],
        state: nextActive ? "resuming" : "pausing",
      },
    });

    const result = await executeToggle({
      active: nextActive,
      observabilityFlowId: tracker.flowId,
      policyAccount: config.policyAccount,
      recurringDelegation: config.recurringDelegation,
    });
    toggleInFlightRef.current = false;

    if (!result.success) {
      tracker.fail("backend_confirm", {
        errorCode: "record_failed",
        persistenceState: "failed",
      });
      setAutodepositOverride(null);
      setAutodepositToggleError(
        result.error ?? "Autodeposit active state update failed."
      );
      return;
    }

    setAutodepositOverride({
      config: {
        ...config,
        scheduledSweeps: nextActive ? result.scheduledSweeps ?? [] : [],
        state: nextActive ? "created" : "paused",
      },
    });
    tracker.complete("ui_commit", { persistenceState: "recorded" });
  }, [autodepositConfig, executeToggle]);
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

  const actions = useEarnActions({
    autodepositConfig,
    hasPosition,
    mainUsdc,
    position,
    refreshPosition,
    setAutodepositOverride,
    setPosition,
    smartAccountData,
    suppressPositionRefreshThroughSlot: suppressSubscriptionRefreshThroughSlot,
    walletAddress,
  });

  return {
    actions,
    autodepositConfig,
    autodepositToggleError,
    earnBalanceUsd,
    hasPosition,
    hasResolvedPosition,
    position,
    scheduledSweeps,
    settingsPda,
    toggleAutodeposit,
    walletAddress,
  };
}
