"use client";

import { shouldRetainConfirmedAutodepositSetup } from "@loyal-labs/shared";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
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
  type SmartAccountSidebarData,
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

export type EarnAutoswapConfigView = Omit<
  NonNullable<SmartAccountSidebarData["earnAutoswap"]>,
  "status"
> & {
  status: "finalizing" | "on" | "paused" | "pausing" | "resuming";
};

export type EarnPositionData = {
  actions: EarnActions;
  autodepositConfig: EarnAutodepositConfigView | null;
  autodepositToggleError: string | null;
  autoswapAvailable: boolean | null;
  autoswapConfig: EarnAutoswapConfigView | null;
  autoswapError: string | null;
  deleteAutoswap: () => Promise<boolean>;
  earnBalanceUsd: number;
  hasPosition: boolean;
  hasResolvedPosition: boolean;
  isAutoswapPending: boolean;
  position: ActiveEarnPosition | null;
  scheduledSweeps: LoadedEarnAutodepositScheduledSweep[];
  setupAutoswap: (request: {
    dailySourceMintSpendingCap: bigint;
  }) => Promise<boolean>;
  settingsPda: string | null | undefined;
  toggleAutodeposit: () => Promise<void>;
  toggleAutoswap: () => Promise<void>;
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

  // A setup confirmed by the wallet is intentionally ahead of the DB-backed
  // projection. Pending refreshes for that same setup must not turn the UI
  // back into "Finish setup"; the settled reconciliation event releases it.
  // Other mutations keep the original fresh-state-wins behavior.
  useEffect(() => {
    if (!toggleInFlightRef.current) {
      setAutodepositOverride((current) => {
        if (!current?.confirmedSetup) {
          return null;
        }
        if (current.confirmedSetup.walletAddress !== walletAddress) {
          return null;
        }
        return shouldRetainConfirmedAutodepositSetup({
          canonical: loadedAutodepositConfig
            ? {
                phase:
                  loadedAutodepositConfig.state === "creating"
                    ? "pending"
                    : "settled",
                policyAccount: loadedAutodepositConfig.policyAccount,
                recurringDelegation:
                  loadedAutodepositConfig.recurringDelegation || null,
              }
            : null,
          confirmed: current.confirmedSetup,
        })
          ? current
          : null;
      });
    }
  }, [loadedAutodepositConfig, walletAddress]);

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

  const [autoswapError, setAutoswapError] = useState<string | null>(null);
  const [autoswapOverride, setAutoswapOverride] = useState<{
    config: EarnAutoswapConfigView | null;
  } | null>(null);
  const autoswapMutationInFlightRef = useRef(false);
  const loadedAutoswapConfig = smartAccountData.earnAutoswap;
  useEffect(() => {
    if (!autoswapMutationInFlightRef.current) {
      setAutoswapOverride(null);
    }
  }, [loadedAutoswapConfig]);
  const autoswapConfig = autoswapOverride
    ? autoswapOverride.config
    : loadedAutoswapConfig;
  const refreshEarnState = smartAccountData.refreshEarnState;
  const executeAutoswapSetup = smartAccountData.executeEarnAutoswapSetup;
  const executeAutoswapToggle = smartAccountData.executeEarnAutoswapToggle;
  const executeAutoswapDelete = smartAccountData.executeEarnAutoswapDelete;
  const setupAutoswap = useCallback(
    async (request: { dailySourceMintSpendingCap: bigint }) => {
      setAutoswapError(null);
      const result = await executeAutoswapSetup(request);
      if (!result.success) {
        setAutoswapError(result.error ?? "Autoswap setup failed.");
        return false;
      }
      return true;
    },
    [executeAutoswapSetup]
  );
  const toggleAutoswap = useCallback(async () => {
    const config = autoswapConfig;
    if (!config || (config.status !== "on" && config.status !== "paused")) {
      return;
    }
    const nextEnabled = config.status === "paused";
    const tracker = createBrowserLifecycleTracker({
      flowName: "earn.autoswap.configuration",
      flowVariant: nextEnabled ? "resume" : "pause",
    });
    tracker.start("intent");
    tracker.observe("backend_confirm", { persistenceState: "not_started" });
    setAutoswapError(null);
    autoswapMutationInFlightRef.current = true;
    setAutoswapOverride({
      config: {
        ...config,
        status: nextEnabled ? "resuming" : "pausing",
      },
    });
    const result = await executeAutoswapToggle({
      enabled: nextEnabled,
      expectedGeneration: config.generation,
      observabilityFlowId: tracker.flowId,
    });
    autoswapMutationInFlightRef.current = false;
    if (!(result.success && result.generation && result.status)) {
      tracker.fail("backend_confirm", {
        errorCode: "record_failed",
        persistenceState: "failed",
      });
      setAutoswapOverride(null);
      setAutoswapError(result.error ?? "Autoswap update failed.");
      await refreshEarnState().catch(() => undefined);
      return;
    }
    setAutoswapOverride({
      config: {
        ...config,
        enabled: result.enabled ?? nextEnabled,
        generation: result.generation,
        status: result.status,
      },
    });
    tracker.complete("ui_commit", { persistenceState: "recorded" });
    await refreshEarnState().catch(() => undefined);
  }, [autoswapConfig, executeAutoswapToggle, refreshEarnState]);
  const deleteAutoswap = useCallback(async () => {
    const config = autoswapConfig;
    if (!config) {
      return true;
    }
    if (config.status === "pausing" || config.status === "resuming") {
      return false;
    }
    setAutoswapError(null);
    const result = await executeAutoswapDelete({
      expectedGeneration: config.generation,
    });
    if (!result.success) {
      setAutoswapError(result.error ?? "Autoswap removal failed.");
      return false;
    }
    setAutoswapOverride({ config: null });
    return true;
  }, [autoswapConfig, executeAutoswapDelete]);
  const autoswapStatus = loadedAutoswapConfig?.status;

  // The chain confirmation deliberately precedes the worker's finalized
  // policy-catalog observation. Poll only that short-lived reconciliation
  // state so the card turns on without requiring a page reload.
  useEffect(() => {
    if (autoswapStatus !== "finalizing") {
      return;
    }
    let canceled = false;
    let attempts = 0;
    const poll = async () => {
      if (canceled) {
        return;
      }
      attempts += 1;
      await refreshEarnState().catch(() => undefined);
      if (!canceled && attempts < 20) {
        window.setTimeout(() => void poll(), 3000);
      }
    };
    const timer = window.setTimeout(() => void poll(), 3000);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [autoswapStatus, refreshEarnState]);
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
    autoswapAvailable: smartAccountData.earnAutoswapAvailable,
    autoswapConfig,
    autoswapError,
    deleteAutoswap,
    earnBalanceUsd,
    hasPosition,
    hasResolvedPosition,
    isAutoswapPending: smartAccountData.isActionPending,
    position,
    scheduledSweeps,
    setupAutoswap,
    settingsPda,
    toggleAutodeposit,
    toggleAutoswap,
    walletAddress,
  };
}
