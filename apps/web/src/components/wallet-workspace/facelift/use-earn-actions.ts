"use client";

import type {
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
} from "@loyal-labs/smart-account-vaults";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ApprovalReviewDisplayItem } from "@/components/wallet-sidebar/approval-review-content";
import type {
  EarnAutodepositDraft,
  EarnDepositDraft,
  EarnDepositSourceOption,
  EarnWithdrawDraft,
  EarnWithdrawSourceOption,
} from "@/components/wallet-sidebar/earn-detail-view";
import {
  advanceEarnDepositReviewStage,
  buildEarnAutodepositCloseReviewItem,
  buildEarnAutodepositSetupReviewItem,
  buildEarnDepositReviewItem,
  buildEarnWithdrawReviewItem,
  createSubmittedEarnDepositReviewState,
  type EarnWithdrawReviewStage,
  getNextEarnWithdrawReviewStage,
} from "@/components/wallet-workspace/earn-deposit-review";
import {
  applySubmittedEarnWithdrawToPosition,
  buildPostDepositEarnPosition,
  createWithdrawSourceOptions,
  DEFAULT_EARN_AUTODEPOSIT_AMOUNT_LABEL,
  EARN_AUTODEPOSIT_MUTATION_RESOURCES,
  EARN_BALANCE_MUTATION_RESOURCES,
  EARN_CLEANUP_MUTATION_RESOURCES,
  EARN_POLICY_MUTATION_RESOURCES,
  EARN_SYNC_RESOURCES,
  getEarnWithdrawDraftAmountRaw,
  isWalletCancellation,
  parseEarnAutodepositExecuteError,
  parseEarnAutodepositExecuteResponse,
  parseTokenAmountLabelToRaw,
  resolveEarnMutationSmartAccountPlan,
  resolveEarnRealtimeResources,
} from "@/components/wallet-workspace/facelift/earn-actions-support";
import {
  CONFIRM_IN_WALLET_MESSAGE,
  earnToast,
} from "@/components/wallet-workspace/facelift/earn-toast";
import { lifecycleOnboarding } from "@/components/wallet-workspace/facelift/lifecycle-onboarding";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import {
  EARN_REALTIME_EVENT_TYPES,
  type EarnAutodepositProgress,
  type EarnExpectedMutationOperation,
  EarnMutationReconciliationRegistry,
  type EarnRealtimeInvalidation,
  fetchEarnAutodepositProgress,
  isEarnAutodepositTerminalState,
  mergeEarnAutodepositProgress,
  useEarnRealtime,
} from "@/features/earn-realtime";
import {
  captureBrowserLoadingMetric,
  captureBrowserLoadingMetricAfterPaint,
  captureBrowserSubmittedFailureMetricAfterPaint,
  createBrowserLifecycleTracker,
  getBrowserPerformanceNow,
  measureBrowserLoadingDependencies,
} from "@/features/observability/client";
import {
  type ExecuteNowState,
  type LifecycleTracker,
  mapExecuteNowState,
  normalizeLifecycleErrorCode,
} from "@/features/observability/lifecycle-contract";
import { resolveBrowserLoadingFailurePhase } from "@/features/observability/metrics-contract";
import {
  type RealtimeResourceRefreshContext,
  useRealtimeResource,
  useRealtimeSync,
  useRealtimeSyncScope,
} from "@/features/realtime-sync";
import type { ActiveEarnPosition } from "@/hooks/use-active-earn-position";
import {
  fetchEarnEarningsRangeSet,
  invalidateEarnEarningsCache,
} from "@/hooks/use-earn-earnings";
import {
  EARN_DEPOSIT_CONFIRMED_BUT_NOT_RECORDED_MESSAGE,
  EARN_DEPOSIT_POLICY_CONFIRMED_BUT_NOT_RECORDED_MESSAGE,
  EARN_WITHDRAW_CONFIRMED_BUT_NOT_RECORDED_MESSAGE,
  EarnPolicyUpdateRequiredClientError,
  getEarnDepositUserErrorMessage,
  isConfirmedSlotUnavailableError,
  prepareEarnCleanupOnServer,
  prepareEarnDepositOnServer,
  prepareEarnWithdrawOnServer,
  type SmartAccountSidebarData,
} from "@/hooks/use-smart-account-sidebar-data";
import { useAuthCapability } from "@/lib/auth/capability";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";
import {
  EarnPrepareRequestError,
  getEarnPrepareLifecycleDiagnostics,
} from "@/lib/yield-optimization/earn-prepare-request.client";
import type {
  LoadedEarnAutodepositConfig,
  LoadedEarnAutodepositScheduledSweep,
} from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import { hasEarnCleanupCandidate } from "@/lib/yield-optimization/earn-cleanup-ui-state";
import {
  fetchEarnTransactions,
  invalidateEarnTransactionsCache,
} from "@/lib/yield-optimization/earn-transactions.client";

// Same local widening the old workspace uses: the loaded state only knows
// created/creating/paused; pausing/resuming/closing are optimistic transients
// while a toggle/close request is in flight.
export type EarnAutodepositConfigView = Omit<
  LoadedEarnAutodepositConfig,
  "state"
> & {
  state:
    | LoadedEarnAutodepositConfig["state"]
    | "closing"
    | "pausing"
    | "resuming";
};

// null = no override (show loaded state); { config } = optimistic overlay,
// where config === null force-clears the rule (post-close) until the loaded
// state catches up.
export type EarnAutodepositOverride = {
  config: EarnAutodepositConfigView | null;
} | null;

type PositionUpdater =
  | ActiveEarnPosition
  | null
  | ((current: ActiveEarnPosition | null) => ActiveEarnPosition | null);

export type EarnActions = {
  authenticatedWalletAddress: string | null;
  closeReconnectPrompt: () => void;
  confirmAutodepositClose: () => Promise<boolean>;
  depositError: string | null;
  depositSource: EarnDepositSourceOption;
  dismissAutodepositClose: () => void;
  autodepositProgressBySlot: Readonly<Record<string, EarnAutodepositProgress>>;
  earnTransactionsRefreshKey: number;
  executeNowError: string | null;
  executeScheduledSweep: (
    sweep: LoadedEarnAutodepositScheduledSweep
  ) => Promise<boolean>;
  hasCleanupCandidate: boolean;
  isExecuteNowPending: boolean;
  isAutodepositPending: boolean;
  isCleanupPending: boolean;
  isDepositPending: boolean;
  isReconnectPromptOpen: boolean;
  isWithdrawPending: boolean;
  mainUsdcAmount: number | null;
  refreshMainUsdcAmount: () => Promise<void>;
  pendingApproval: PendingEarnApproval | null;
  pendingTransactionSignatures: string[];
  prefetchDepositPreparation: (amountLabel: string, mint: string) => void;
  requestAutodepositClose: () => void;
  runCleanup: () => Promise<boolean>;
  saveAutodeposit: (keepAmountLabel: string) => Promise<boolean>;
  submitDeposit: (args: {
    amountLabel: string;
    forecastApyBps: number;
    mint: string;
    symbol: string;
  }) => Promise<boolean>;
  submitWithdraw: (draft: EarnWithdrawDraft) => Promise<boolean>;
  autodepositError: string | null;
  withdrawError: string | null;
  withdrawSources: EarnWithdrawSourceOption[];
};

// The OG right-pane review restored as a modal gate: a flow parks here after
// prepare and awaits the user's Approve/Reject before signing.
export type PendingEarnApproval = {
  approve: () => void;
  item: ApprovalReviewDisplayItem;
  reject: () => void;
};

// The old workspace's Earn mutation orchestration (app-wallet-workspace.tsx
// handlers) rebuilt for the facelift panes. Every executor call, precondition,
// optimistic update, observability event and refresh registration mirrors the
// monolith; the one structural change is that the review overlay's
// per-stage "Continue" clicks are auto-chained after a single up-front
// approval gate — the wallet still prompts per signature.
export function useEarnActions(deps: {
  autodepositConfig: EarnAutodepositConfigView | null;
  hasPosition: boolean;
  mainUsdc: {
    amount: number | null;
    refresh: (isCurrent?: () => boolean) => Promise<void>;
    setAmountRaw: Dispatch<SetStateAction<bigint | null>>;
  };
  position: ActiveEarnPosition | null;
  refreshPosition: (
    context: RealtimeResourceRefreshContext
  ) => Promise<unknown>;
  setAutodepositOverride: Dispatch<SetStateAction<EarnAutodepositOverride>>;
  setPosition: (next: PositionUpdater) => void;
  smartAccountData: SmartAccountSidebarData;
  suppressPositionRefreshThroughSlot: (slot?: string) => void;
  walletAddress: string | null;
}): EarnActions {
  const {
    autodepositConfig,
    hasPosition,
    mainUsdc,
    position,
    refreshPosition,
    setAutodepositOverride,
    setPosition,
    smartAccountData,
    suppressPositionRefreshThroughSlot,
    walletAddress,
  } = deps;

  const publicEnv = usePublicEnv();
  const { connection } = useConnection();
  const wallet = useWallet();
  const { user } = useAuthSession();
  const { isHydrated, isSignedIn } = useAuthCapability();
  const { open: openSignIn } = useSignInModal();

  // app-wallet-workspace.tsx:1730-1735, 4377-4409
  const hasSmartAccountSession =
    isSignedIn && Boolean(user?.smartAccountAddress && user?.settingsPda);
  const canMutateAccount = hasSmartAccountSession;
  const authenticatedWalletAddress = user?.walletAddress ?? null;
  const connectedWalletAddress = wallet.publicKey?.toBase58() ?? null;
  const canSignAccountActions =
    Boolean(authenticatedWalletAddress) &&
    connectedWalletAddress === authenticatedWalletAddress;
  const [isReconnectPromptOpen, setIsReconnectPromptOpen] = useState(false);

  // Approval gate: flows await the resolved promise between prepare and
  // sign; the shell renders the sheet from this state.
  const [pendingApproval, setPendingApproval] =
    useState<PendingEarnApproval | null>(null);
  const requestApproval = useCallback(
    (item: ApprovalReviewDisplayItem) =>
      new Promise<boolean>((resolve) => {
        setPendingApproval({
          approve: () => {
            setPendingApproval(null);
            resolve(true);
          },
          item,
          reject: () => {
            setPendingApproval(null);
            resolve(false);
          },
        });
      }),
    []
  );
  const ensureCanSignAccountAction = useCallback(() => {
    if (!authenticatedWalletAddress) {
      openSignIn();
      return false;
    }
    if (!canSignAccountActions) {
      setIsReconnectPromptOpen(true);
      return false;
    }
    return true;
  }, [authenticatedWalletAddress, canSignAccountActions, openSignIn]);
  const closeReconnectPrompt = useCallback(
    () => setIsReconnectPromptOpen(false),
    []
  );

  // Signatures of just-confirmed deposits/withdrawals that the indexed
  // transactions list may not contain yet (~5s lag). The activity card shows
  // a skeleton row per signature until the refetched list includes it; the
  // timeout is only a safety valve against an indexer that never catches up.
  const [pendingTransactionSignatures, setPendingTransactionSignatures] =
    useState<string[]>([]);
  const expectEarnTransaction = useCallback((signature?: string) => {
    if (!signature) {
      return;
    }
    setPendingTransactionSignatures((current) =>
      current.includes(signature) ? current : [...current, signature]
    );
    // ponytail: 20s cap — the indexer lag is ~5s, and a mismatch must never
    // pin a skeleton row for long.
    window.setTimeout(() => {
      setPendingTransactionSignatures((current) =>
        current.filter((existing) => existing !== signature)
      );
    }, 20_000);
  }, []);

  const [depositError, setDepositError] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [autodepositError, setAutodepositError] = useState<string | null>(null);
  const [isDepositPending, setIsDepositPending] = useState(false);
  const [isWithdrawPending, setIsWithdrawPending] = useState(false);
  const [isCleanupPending, setIsCleanupPending] = useState(false);
  const [isAutodepositPending, setIsAutodepositPending] = useState(false);
  const [isExecuteNowPending, setIsExecuteNowPending] = useState(false);
  const [executeNowError, setExecuteNowError] = useState<string | null>(null);
  // Per-slot execute-now progress (app-wallet-workspace.tsx:1899-1906,
  // 2558-2561): drives the sweep row's state labels and the fallback poll.
  const [activeScheduledSweepSlotId, setActiveScheduledSweepSlotId] = useState<
    string | null
  >(null);
  const [autodepositProgressBySlot, setAutodepositProgressBySlot] = useState<
    Record<string, EarnAutodepositProgress>
  >({});
  const executeNowLifecycleRef = useRef<{
    scheduledSlotId: string | null;
    tracker: LifecycleTracker;
  } | null>(null);
  const withdrawTrackerRef = useRef<LifecycleTracker | null>(null);
  const autodepositTrackerRef = useRef<LifecycleTracker | null>(null);
  const autodepositClosePreparedRef =
    useRef<SmartAccountPreparedEarnUsdcAutodepositClose | null>(null);
  const autodepositCloseMetricRef = useRef<{
    previewMetricSent: boolean;
    startedAtMs: number;
    tracker: LifecycleTracker;
  } | null>(null);
  const autodepositFloorInFlightRef = useRef(false);

  // ---- Wallet USDC funding balance (app-wallet-workspace.tsx:1765-1805) ----
  // The ATA-read hook itself lives in use-earn-position-data so its refresh
  // can feed useSmartAccountSidebarData's onAfterTx.
  const trackedKaminoUsdcMint = useMemo(
    () => resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  const setMainUsdcAmountRaw = mainUsdc.setAmountRaw;
  const refreshMainUsdc = mainUsdc.refresh;
  // Swaps and other non-Earn flows change the wallet's stablecoin balances
  // without passing through this hook's onAfterTx refresh, so consumers (the
  // deposit pane) re-read the funding balance on demand.
  const refreshMainUsdcAmount = useCallback(
    () => refreshMainUsdc(),
    [refreshMainUsdc]
  );
  const debitMainAccountUsdcBalance = useCallback(
    (amountRaw: bigint) => {
      setMainUsdcAmountRaw((current) => {
        if (current === null) {
          return current;
        }
        return current > amountRaw ? current - amountRaw : BigInt(0);
      });
    },
    [setMainUsdcAmountRaw]
  );
  const creditMainAccountUsdcBalance = useCallback(
    (amountRaw: bigint) => {
      setMainUsdcAmountRaw((current) =>
        current === null ? current : current + amountRaw
      );
    },
    [setMainUsdcAmountRaw]
  );

  // ---- Realtime refresh stack (app-wallet-workspace.tsx:1907-2224) ----
  const settingsPda = smartAccountData.overview?.settingsPda;
  const earnVaultAddress = smartAccountData.earnVaultPubkey;
  const refreshSmartAccountGroups = smartAccountData.refreshGroups;
  const refreshSmartAccountMutationPlan = smartAccountData.refreshMutationPlan;
  const [earnTransactionsRefreshKey, setEarnTransactionsRefreshKey] =
    useState(0);
  const { invalidate: invalidateRealtimeResources } = useRealtimeSync();
  const refreshEarnState = useCallback(
    () =>
      refreshSmartAccountGroups({
        groups: ["earn"],
        refreshAuthenticatedWallet: false,
      }),
    [refreshSmartAccountGroups]
  );
  const refreshEarnTransactions = useCallback(
    async (context: RealtimeResourceRefreshContext) => {
      if (!(settingsPda && walletAddress)) {
        return;
      }
      invalidateEarnTransactionsCache({
        settingsPda,
        solanaEnv: publicEnv.solanaEnv,
        walletAddress,
      });
      await fetchEarnTransactions({
        settingsPda,
        solanaEnv: publicEnv.solanaEnv,
        walletAddress,
      });
      if (!context.isCurrent()) {
        return;
      }
      setEarnTransactionsRefreshKey((value) => value + 1);
    },
    [settingsPda, publicEnv.solanaEnv, walletAddress]
  );
  const earnEarningsRevalidationKey = position?.principalAmountRaw ?? "0";
  const earnEarningsCacheKey = [
    publicEnv.solanaEnv,
    walletAddress ?? "anonymous",
    settingsPda ?? "no-settings",
    "vault-1",
  ].join(":");
  const refreshEarnEarnings = useCallback(
    async (context: RealtimeResourceRefreshContext) => {
      if (!(settingsPda && walletAddress)) {
        return;
      }
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const scopedCacheKey = `${earnEarningsCacheKey}:${timezone}`;
      invalidateEarnEarningsCache(scopedCacheKey);
      await fetchEarnEarningsRangeSet(scopedCacheKey, {
        revalidationKey: earnEarningsRevalidationKey,
        settingsPda,
        solanaEnv: publicEnv.solanaEnv,
        strict: true,
        timezone,
        walletAddress,
      });
      if (!context.isCurrent()) {
        return;
      }
    },
    [
      earnEarningsCacheKey,
      earnEarningsRevalidationKey,
      settingsPda,
      walletAddress,
      publicEnv.solanaEnv,
    ]
  );
  useRealtimeResource(EARN_SYNC_RESOURCES.state, refreshEarnState);
  useRealtimeResource(EARN_SYNC_RESOURCES.position, refreshPosition, {
    handlesInFlightInvalidation: true,
  });
  useRealtimeResource(
    EARN_SYNC_RESOURCES.transactions,
    refreshEarnTransactions
  );
  useRealtimeResource(EARN_SYNC_RESOURCES.earnings, refreshEarnEarnings);
  const refreshAllEarnResources = useCallback(
    () =>
      invalidateRealtimeResources([
        EARN_SYNC_RESOURCES.state,
        EARN_SYNC_RESOURCES.position,
        EARN_SYNC_RESOURCES.transactions,
        EARN_SYNC_RESOURCES.earnings,
      ]),
    [invalidateRealtimeResources]
  );
  const earnMutationRegistryRef =
    useRef<EarnMutationReconciliationRegistry | null>(null);
  if (!earnMutationRegistryRef.current) {
    earnMutationRegistryRef.current = new EarnMutationReconciliationRegistry({
      onFallbackError: (error, expected) => {
        console.warn("[earn-sync] mutation fallback refresh failed", {
          errorMessage:
            error instanceof Error ? error.message : "Unknown sync error.",
          operation: expected.operation,
          signature: expected.signature,
          targetId: expected.targetId,
        });
      },
    });
  }
  const earnMutationSequenceRef = useRef(0);
  const earnRealtimeIdentity = useMemo(() => {
    if (!(walletAddress && settingsPda && earnVaultAddress)) {
      return null;
    }
    return {
      earnVaultAddress,
      settingsPda,
      solanaEnv: publicEnv.solanaEnv,
      walletAddress,
    };
  }, [earnVaultAddress, settingsPda, walletAddress, publicEnv.solanaEnv]);
  const earnRealtimeScope = earnRealtimeIdentity
    ? [
        earnRealtimeIdentity.walletAddress,
        earnRealtimeIdentity.settingsPda,
        earnRealtimeIdentity.earnVaultAddress,
        earnRealtimeIdentity.solanaEnv,
      ].join(":")
    : null;
  const activeEarnRealtimeScopeRef = useRef(earnRealtimeScope);
  activeEarnRealtimeScopeRef.current = earnRealtimeScope;
  const registerExpectedEarnMutation = useCallback(
    ({
      operation,
      resources,
      signature,
      targetId,
    }: {
      operation: EarnExpectedMutationOperation;
      resources: readonly string[];
      signature?: string;
      targetId?: string;
    }) => {
      const registry = earnMutationRegistryRef.current;
      if (
        !registry ||
        activeEarnRealtimeScopeRef.current !== earnRealtimeScope
      ) {
        return;
      }
      earnMutationSequenceRef.current += 1;
      const relatedPlan = resolveEarnMutationSmartAccountPlan({
        operation,
        resources,
      });
      registry.register(
        {
          key: [
            earnRealtimeScope ?? "unscoped",
            operation,
            targetId ?? signature ?? "unidentified",
            earnMutationSequenceRef.current,
          ].join(":"),
          operation,
          reconcileRelated: relatedPlan
            ? () => refreshSmartAccountMutationPlan(relatedPlan)
            : undefined,
          resources,
          signature,
          targetId,
        },
        (fallbackResources) => invalidateRealtimeResources(fallbackResources)
      );
    },
    [
      earnRealtimeScope,
      invalidateRealtimeResources,
      refreshSmartAccountMutationPlan,
    ]
  );
  const handleEarnRealtimeInvalidationBatch = useCallback(
    async (
      events: readonly Parameters<typeof resolveEarnRealtimeResources>[0][]
    ) => {
      const reconciliation = earnMutationRegistryRef.current?.plan(
        events.map((event) => ({
          event,
          resources: resolveEarnRealtimeResources(event),
        }))
      );
      const resources =
        reconciliation?.resources ??
        events.flatMap(resolveEarnRealtimeResources);
      try {
        await Promise.all([
          resources.length > 0
            ? invalidateRealtimeResources(resources)
            : Promise.resolve(),
          reconciliation?.reconcileRelated() ?? Promise.resolve(),
        ]);
        reconciliation?.accept(true);
      } catch (error) {
        reconciliation?.accept(false);
        console.warn("[earn-sync] failed to apply realtime invalidation", {
          errorMessage:
            error instanceof Error ? error.message : "Unknown sync error.",
        });
        throw error;
      }
    },
    [invalidateRealtimeResources]
  );
  useRealtimeSyncScope(earnRealtimeScope);
  useEffect(() => {
    const registry = earnMutationRegistryRef.current;
    registry?.reset();
    earnMutationSequenceRef.current = 0;
    return () => registry?.reset();
  }, [earnRealtimeScope]);
  // Execute-now progress plumbing (app-wallet-workspace.tsx:2018-2302): SSE
  // autodeposit events update the per-slot progress map + lifecycle tracker;
  // when SSE is not connected a bounded fallback poll fetches progress and
  // feeds it through the same invalidation batch so the UI refreshes live.
  const applyEarnAutodepositProgress = useCallback(
    (progress: EarnAutodepositProgress) => {
      const scheduledSlotId = progress.scheduledSlotId;
      setAutodepositProgressBySlot((current) => ({
        ...current,
        [scheduledSlotId]: mergeEarnAutodepositProgress(
          current[scheduledSlotId],
          progress
        ),
      }));
    },
    []
  );
  const recordExecuteNowProgress = useCallback(
    (
      progress: EarnAutodepositProgress,
      source: "sse" | "fallback",
      occurredAt?: string
    ) => {
      const active = executeNowLifecycleRef.current;
      if (
        !(active && active.scheduledSlotId) ||
        active.scheduledSlotId !== progress.scheduledSlotId ||
        progress.state === "scheduled" ||
        progress.state === "requesting"
      ) {
        return;
      }
      const state = progress.state as ExecuteNowState;
      const mapped = mapExecuteNowState(state);
      const diagnostics = {
        executeNowState: state,
        ...(state === "failed" || state === "released"
          ? { errorCode: normalizeLifecycleErrorCode(progress.failureCode) }
          : {}),
        scheduledSlotId: progress.scheduledSlotId,
      };
      const options = {
        source,
        ...(occurredAt ? { timestamp: occurredAt } : {}),
      };
      if (mapped.outcome === "completed") {
        active.tracker.complete(mapped.stage, diagnostics, options);
      } else if (mapped.outcome === "failed") {
        active.tracker.fail(mapped.stage, diagnostics, options);
      } else if (mapped.outcome === "cancelled") {
        active.tracker.cancel(mapped.stage, diagnostics, options);
      } else {
        active.tracker.observe(mapped.stage, diagnostics, options);
      }
    },
    []
  );
  const handleEarnRealtimeInvalidation = useCallback(
    (event: EarnRealtimeInvalidation) => {
      if (
        event.eventType !== EARN_REALTIME_EVENT_TYPES.autodeposit ||
        !event.scheduledSlotId ||
        !event.state
      ) {
        return;
      }
      const progress = {
        eventId: event.eventId,
        failureCode: event.failureCode,
        occurredAt: event.occurredAt,
        scheduledSlotId: event.scheduledSlotId,
        state: event.state,
      };
      applyEarnAutodepositProgress(progress);
      recordExecuteNowProgress(progress, "sse", event.occurredAt);
    },
    [applyEarnAutodepositProgress, recordExecuteNowProgress]
  );
  useEffect(() => {
    setActiveScheduledSweepSlotId(null);
    setAutodepositProgressBySlot({});
  }, [earnRealtimeIdentity]);
  const earnRealtimeConnectionState = useEarnRealtime({
    enabled: isHydrated && hasSmartAccountSession,
    identity: earnRealtimeIdentity,
    onInvalidation: handleEarnRealtimeInvalidation,
    onInvalidationBatch: handleEarnRealtimeInvalidationBatch,
    onCursorlessConnected: refreshAllEarnResources,
    onResyncRequired: refreshAllEarnResources,
  });
  const activeAutodepositProgress = activeScheduledSweepSlotId
    ? autodepositProgressBySlot[activeScheduledSweepSlotId]
    : undefined;
  const isActiveAutodepositTerminal = Boolean(
    activeAutodepositProgress &&
      isEarnAutodepositTerminalState(activeAutodepositProgress.state)
  );
  useEffect(() => {
    if (
      !activeScheduledSweepSlotId ||
      earnRealtimeConnectionState === "connected" ||
      isActiveAutodepositTerminal
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();
    const run = async () => {
      for (const delayMs of [4000, 8000, 16_000, 30_000]) {
        await new Promise<void>((resolve) => {
          timer = window.setTimeout(resolve, delayMs);
        });
        if (cancelled) {
          return;
        }
        const progress = await fetchEarnAutodepositProgress(
          activeScheduledSweepSlotId,
          controller.signal
        ).catch(() => null);
        if (cancelled || !progress) {
          continue;
        }
        applyEarnAutodepositProgress(progress);
        recordExecuteNowProgress(progress, "fallback", progress.occurredAt);
        try {
          await handleEarnRealtimeInvalidationBatch([
            {
              eventId: progress.eventId ?? "0",
              eventType: EARN_REALTIME_EVENT_TYPES.autodeposit,
              failureCode: progress.failureCode,
              occurredAt: progress.occurredAt,
              scheduledSlotId: progress.scheduledSlotId,
              schemaVersion: 1,
              scope: earnRealtimeScope ?? "earn-fallback",
              state: progress.state,
            },
          ]);
        } catch (error) {
          console.warn("[earn-sync] fallback invalidation failed", {
            errorMessage:
              error instanceof Error ? error.message : "Unknown sync error.",
            scheduledSlotId: progress.scheduledSlotId,
          });
        }
        if (isEarnAutodepositTerminalState(progress.state)) {
          return;
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    activeScheduledSweepSlotId,
    applyEarnAutodepositProgress,
    earnRealtimeConnectionState,
    earnRealtimeScope,
    handleEarnRealtimeInvalidationBatch,
    isActiveAutodepositTerminal,
    recordExecuteNowProgress,
  ]);

  // ---- Deposit source (app-wallet-workspace.tsx earnDepositSources "main") --
  const depositSource = useMemo<EarnDepositSourceOption>(() => {
    const balance = mainUsdc.amount ?? 0;
    const [whole = "0", fraction = "00"] = balance
      .toLocaleString("en-US", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })
      .split(".");
    return {
      addressLabel: walletAddress
        ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
        : "Not connected",
      balance,
      balanceFraction: fraction,
      balanceWhole: whole,
      decimals: 6,
      icon: "/wallet-workspace/facelift/stablecoins-icon.svg",
      id: "main",
      label: walletAddress ? "Main" : "Wallet",
      mint: trackedKaminoUsdcMint ?? null,
    };
  }, [mainUsdc.amount, trackedKaminoUsdcMint, walletAddress]);

  // Warms the Kamino instruction cache while the user is still on the amount
  // input, so the submit-time prepare skips its longest network leg. Fire and
  // forget: a miss (target drift, parse failure, API error) just means the
  // prepare falls back to a live fetch, exactly as without prefetching.
  const prefetchDepositPreparation = useCallback(
    (amountLabel: string, mint: string) => {
      const overview = smartAccountData.overview;
      if (!overview) {
        return;
      }
      let amountRaw: bigint;
      try {
        amountRaw = parseTokenAmountLabelToRaw(
          amountLabel,
          depositSource.decimals
        );
      } catch {
        return;
      }
      if (amountRaw <= BigInt(0)) {
        return;
      }
      void prepareEarnDepositOnServer({ amountRaw, mint }).catch(() => null);
    },
    [depositSource.decimals, smartAccountData.overview]
  );

  const prepareEarnWithdrawInBrowser = useCallback(
    async (
      draft: EarnWithdrawDraft,
      observabilityFlowId?: string
    ): Promise<SmartAccountPreparedEarnUsdcWithdraw> => {
      const requestedAmountRaw = getEarnWithdrawDraftAmountRaw(draft);
      return prepareEarnWithdrawOnServer({
        amountRaw: draft.mode === "full" ? "max" : requestedAmountRaw,
        observabilityFlowId,
        sourceId: draft.source.sourceId,
      });
    },
    []
  );

  // ---- Deposit (app-wallet-workspace.tsx:5165-5332 + 5508-5843) ----
  const submitDeposit = useCallback(
    async (args: {
      amountLabel: string;
      forecastApyBps: number;
      mint: string;
      symbol: string;
    }): Promise<boolean> => {
      if (!canMutateAccount) {
        openSignIn();
        return false;
      }

      const draft: EarnDepositDraft = {
        amount: Number(args.amountLabel.replace(/,/g, "")) || 0,
        amountLabel: args.amountLabel,
        forecastApyBps: args.forecastApyBps,
        source: { ...depositSource, mint: args.mint },
        symbol: args.symbol,
        tokenDecimals: depositSource.decimals,
        tokenMint: args.mint,
      };
      const requiresPolicySetup =
        smartAccountData.requiresEarnPolicySetupForDeposit;
      const tracker = createBrowserLifecycleTracker({
        flowName: "earn.deposit",
        flowVariant: hasPosition
          ? "top_up"
          : smartAccountData.earnOnboarding
          ? "resumed"
          : "initial",
      });
      tracker.start("intent", {
        policyMode: requiresPolicySetup ? "create" : "reuse",
      });
      setDepositError(null);
      setIsDepositPending(true);
      earnToast.begin("deposit");
      earnToast.loading("Preparing deposit");
      let phase: "prepare" | "sign" = "prepare";
      const interactionStartedAtMs = getBrowserPerformanceNow();
      let previewMetricSent = false;
      let walletSubmittedAtMs: number | null = null;
      const markWalletSubmitted = () => {
        walletSubmittedAtMs ??= getBrowserPerformanceNow();
      };

      const commitDepositSuccess = (commit: {
        amountRaw: bigint;
        preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
        result: {
          confirmedSlot?: string;
          error?: string;
          signature?: string;
          status?: string;
        };
      }) => {
        if (commit.result.status === "confirmation_record_failed") {
          setDepositError(
            commit.result.error ??
              EARN_DEPOSIT_CONFIRMED_BUT_NOT_RECORDED_MESSAGE
          );
        }
        tracker.observe("slot_resolve", { chainState: "confirmed" });
        tracker.observe("backend_confirm", {
          chainState: "confirmed",
          persistenceState:
            commit.result.status === "confirmation_record_failed"
              ? "failed"
              : "recorded",
        });
        registerExpectedEarnMutation({
          operation: "deposit",
          resources: EARN_BALANCE_MUTATION_RESOURCES,
          signature: commit.result.signature,
        });
        expectEarnTransaction(commit.result.signature);
        setPosition((current) =>
          buildPostDepositEarnPosition({
            amountRaw: commit.amountRaw,
            confirmedSlot: commit.result.confirmedSlot,
            current,
            preparedDeposit: commit.preparedDeposit,
          })
        );
        if (
          trackedKaminoUsdcMint ===
          commit.preparedDeposit.persistence.depositMint
        ) {
          debitMainAccountUsdcBalance(commit.amountRaw);
        }
        suppressPositionRefreshThroughSlot(commit.result.confirmedSlot);
        if (walletSubmittedAtMs !== null) {
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.deposit",
            phase: "wallet_confirmation_to_ui",
            startedAtMs: walletSubmittedAtMs,
          });
        }
        tracker.complete("ui_commit", {
          chainState: "confirmed",
          persistenceState:
            commit.result.status === "confirmation_record_failed"
              ? "failed"
              : "recorded",
        });
        earnToast.success("Deposited");
        lifecycleOnboarding.depositConfirmed();
      };

      try {
        tracker.observe("prepare", {
          policyMode: requiresPolicySetup ? "create" : "reuse",
        });
        const amountRaw = parseTokenAmountLabelToRaw(
          draft.amountLabel,
          draft.tokenDecimals
        );
        const runPrepareOnce = () =>
          measureBrowserLoadingDependencies({
            flowId: tracker.flowId,
            operation: "earn.deposit",
            rpcEndpoint: connection.rpcEndpoint,
            run: () =>
              prepareEarnDepositOnServer({
                amountRaw,
                mint: args.mint,
                observabilityFlowId: tracker.flowId,
              }),
          });
        // The reserve verification feed can flap a mint out of eligibility
        // for up to a round (~1 min). Bounded auto-retry converts most of
        // those into a slightly slower success instead of surfacing the
        // no_eligible_reserve 409 for hand-retries (observed live
        // 2026-08-13 during the multi-mint rollout).
        const runPrepare = async () => {
          for (let attempt = 0; ; attempt += 1) {
            try {
              return await runPrepareOnce();
            } catch (error) {
              if (
                !(error instanceof EarnPrepareRequestError) ||
                error.code !== "no_eligible_reserve" ||
                attempt >= 3
              ) {
                throw error;
              }
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        };
        let preparedDeposit: Awaited<ReturnType<typeof runPrepare>>;
        try {
          preparedDeposit = await runPrepare();
        } catch (error) {
          if (!(error instanceof EarnPolicyUpdateRequiredClientError)) {
            throw error;
          }
          // The wallet's legacy route policy cannot authorize this
          // Token-2022 mint (ASK-2108). Create the owner-neutral pair as an
          // inline toast step — the legacy pair is never mutated — then
          // re-prepare: the server resolves the new pair after confirm. A
          // second update-required failure falls through to the normal
          // error path, so this cannot loop.
          earnToast.begin("deposit-policy-update");
          earnToast.loading("Updating Earn policy");
          const policySetup = await smartAccountData.executeEarnPolicySetup({
            force: true,
          });
          if (!policySetup.success) {
            throw new Error(
              policySetup.error ?? "Failed to update Earn policy."
            );
          }
          preparedDeposit = await runPrepare();
        }
        const shouldBypassTopUpPreview =
          hasPosition &&
          !requiresPolicySetup &&
          !preparedDeposit.policySetupPrepared &&
          !preparedDeposit.policyFinalizePrepared;
        tracker.observe("review", {
          policyMode: requiresPolicySetup ? "create" : "reuse",
          reviewBypassed: hasPosition,
        });

        // Only first deposits gate on the approval sheet; top-ups skip it
        // even when the prepare bundles policy repair — the wallet still
        // prompts per signature.
        if (hasPosition) {
          captureBrowserLoadingMetric({
            durationMs: Math.max(
              0,
              getBrowserPerformanceNow() - interactionStartedAtMs
            ),
            flowId: tracker.flowId,
            operation: "earn.deposit",
            phase: "interaction_to_preview",
            presentation: "wallet",
          });
          previewMetricSent = true;
        } else {
          earnToast.loading("Waiting for approval");
          const approvalPromise = requestApproval(
            buildEarnDepositReviewItem({
              draft,
              isPolicySetupFlow: requiresPolicySetup,
              preparedDeposit,
              showBatchTransactions: Boolean(wallet.signAllTransactions),
            })
          );
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.deposit",
            phase: "interaction_to_preview",
            presentation: "in_app",
            startedAtMs: interactionStartedAtMs,
          });
          previewMetricSent = true;
          const approved = await approvalPromise;
          if (!approved) {
            tracker.cancel("review", { errorCode: "wallet_rejected" });
            return false;
          }
        }

        if (!ensureCanSignAccountAction()) {
          return false;
        }
        phase = "sign";
        earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);

        if (shouldBypassTopUpPreview) {
          tracker.observe("wallet_submit_confirm", {
            chainState: "submitted",
            executionMode: "single",
            policyMode: "reuse",
          });
          const result = await smartAccountData.executeEarnDeposit({
            amountRaw,
            mint: preparedDeposit.persistence.depositMint,
            observabilityFlowId: tracker.flowId,
            onWalletSubmitted: markWalletSubmitted,
            preparedDeposit,
          });
          if (!result.success) {
            if (result.status === "confirmation_record_failed") {
              tracker.fail("backend_confirm", {
                chainState: "confirmed",
                errorCode: "record_failed",
                persistenceState: "failed",
              });
              throw new Error(EARN_DEPOSIT_CONFIRMED_BUT_NOT_RECORDED_MESSAGE);
            }
            throw new Error(result.error ?? "Earn deposit failed.");
          }
          commitDepositSuccess({ amountRaw, preparedDeposit, result });
          return true;
        }

        // Policy-setup flow. The old workspace pauses here for the review
        // overlay; the facelift chains straight into the staged signing the
        // overlay's Continue button would run.
        let reviewState = createSubmittedEarnDepositReviewState({
          draft,
          preparedDeposit,
          requiresPolicySetup:
            requiresPolicySetup || Boolean(preparedDeposit.policySetupPrepared),
        });
        let stage = reviewState.stage;
        let stageSignatures: {
          policyConfirmedSlot?: string;
          policySignature?: string;
          setupPolicyConfirmedSlot?: string;
          setupPolicySignature?: string;
        } = {};

        if (stage === "policy" || stage === "policy-finalize") {
          tracker.observe(stage === "policy" ? "policy" : "policy_finalize", {
            chainState: "not_submitted",
            executionMode: "batch",
            policyMode: "create",
          });
          tracker.observe("wallet_submit_confirm", {
            chainState: "submitted",
            executionMode: "batch",
            policyMode: "create",
          });
          const batchResult = await smartAccountData.executeEarnDepositBatch({
            amountRaw,
            mint: preparedDeposit.persistence.depositMint,
            observabilityFlowId: tracker.flowId,
            onWalletSubmitted: markWalletSubmitted,
            preparedDeposit,
            startStage: stage,
            ...stageSignatures,
          });
          if (!batchResult.batchUnavailable) {
            stageSignatures = {
              ...stageSignatures,
              ...(batchResult.policySignature
                ? {
                    policyConfirmedSlot: batchResult.policyConfirmedSlot,
                    policySignature: batchResult.policySignature,
                  }
                : {}),
              ...(batchResult.setupPolicySignature
                ? {
                    setupPolicyConfirmedSlot:
                      batchResult.setupPolicyConfirmedSlot,
                    setupPolicySignature: batchResult.setupPolicySignature,
                  }
                : {}),
            };
            if (!batchResult.success) {
              if (batchResult.status === "confirmation_record_failed") {
                tracker.fail("backend_confirm", {
                  chainState: "confirmed",
                  errorCode: "record_failed",
                  persistenceState: "failed",
                });
                throw new Error(
                  EARN_DEPOSIT_POLICY_CONFIRMED_BUT_NOT_RECORDED_MESSAGE
                );
              }
              // ponytail: the monolith resumes from batchResult.resumeStage on
              // retry; here a retry re-prepares and the confirmed policy is
              // simply reused by the backend.
              throw new Error(batchResult.error ?? "Earn deposit failed.");
            }
            const policySignature =
              batchResult.setupPolicySignature ?? batchResult.policySignature;
            if (policySignature) {
              registerExpectedEarnMutation({
                operation: "policy_setup",
                resources: EARN_POLICY_MUTATION_RESOURCES,
                signature: policySignature,
              });
            }
            commitDepositSuccess({
              amountRaw,
              preparedDeposit,
              result: batchResult,
            });
            return true;
          }
        }

        // Sequential fallback: sign each policy stage, then the deposit.
        for (;;) {
          if (stage === "policy" || stage === "policy-finalize") {
            tracker.observe(stage === "policy" ? "policy" : "policy_finalize", {
              chainState: "not_submitted",
              executionMode: "sequential",
              policyMode: "create",
            });
            tracker.observe("wallet_submit_confirm", {
              chainState: "submitted",
              executionMode: "sequential",
            });
            earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);
            const result = await smartAccountData.executeEarnDepositPolicyStage(
              {
                observabilityFlowId: tracker.flowId,
                onWalletSubmitted: markWalletSubmitted,
                preparedDeposit,
                stage,
              }
            );
            if (!result.success) {
              if (result.status === "confirmation_record_failed") {
                tracker.fail("backend_confirm", {
                  chainState: "confirmed",
                  errorCode: "record_failed",
                  persistenceState: "failed",
                });
                throw new Error(
                  EARN_DEPOSIT_POLICY_CONFIRMED_BUT_NOT_RECORDED_MESSAGE
                );
              }
              throw new Error(result.error ?? "Earn policy approval failed.");
            }
            stageSignatures =
              stage === "policy"
                ? {
                    ...stageSignatures,
                    policyConfirmedSlot: result.confirmedSlot,
                    policySignature: result.signature,
                  }
                : {
                    ...stageSignatures,
                    setupPolicyConfirmedSlot: result.confirmedSlot,
                    setupPolicySignature: result.signature,
                  };
            registerExpectedEarnMutation({
              operation: "policy_setup",
              resources: EARN_POLICY_MUTATION_RESOURCES,
              signature: result.signature,
            });
            const nextReviewState = advanceEarnDepositReviewStage(reviewState);
            if (nextReviewState.stage === reviewState.stage) {
              throw new Error("Earn deposit approval flow did not advance.");
            }
            reviewState = nextReviewState;
            stage = reviewState.stage;
            continue;
          }

          tracker.observe("wallet_submit_confirm", {
            chainState: "submitted",
            executionMode: "sequential",
          });
          earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);
          const result = await smartAccountData.executeEarnDeposit({
            amountRaw,
            mint: preparedDeposit.persistence.depositMint,
            observabilityFlowId: tracker.flowId,
            onWalletSubmitted: markWalletSubmitted,
            ...stageSignatures,
            preparedDeposit,
          });
          if (!result.success) {
            if (result.status === "confirmation_record_failed") {
              tracker.fail("backend_confirm", {
                chainState: "confirmed",
                errorCode: "record_failed",
                persistenceState: "failed",
              });
              throw new Error(EARN_DEPOSIT_CONFIRMED_BUT_NOT_RECORDED_MESSAGE);
            }
            throw new Error(result.error ?? "Earn deposit failed.");
          }
          commitDepositSuccess({ amountRaw, preparedDeposit, result });
          return true;
        }
      } catch (error) {
        // The user-facing copy below rewrites the underlying failure; keep the
        // raw error findable in the console for support/debugging.
        console.error(`[earn.deposit] ${phase} failed`, error);
        // app-wallet-workspace.tsx:5300-5312 (prepare) / 5804-5825 (signing)
        const raw = getEarnDepositUserErrorMessage(
          error,
          phase === "prepare" ? "Failed to prepare Earn deposit." : undefined
        );
        const haystack = raw.toLowerCase();
        const isRentError =
          haystack.includes("insufficient funds for rent") ||
          haystack.includes("insufficient lamports") ||
          haystack.includes("would result in account being unable to pay rent");
        setDepositError(
          error instanceof EarnPolicyUpdateRequiredClientError
            ? "Update your Earn policy to enable this stablecoin before depositing."
            : isRentError && !haystack.includes("top up")
            ? "Stash must keep a minimum SOL balance for rent. Try a smaller amount."
            : raw
        );
        if (isWalletCancellation(error)) {
          tracker.cancel("wallet_submit_confirm", {
            errorCode: "wallet_rejected",
          });
        } else if (
          phase === "prepare" &&
          error instanceof EarnPrepareRequestError
        ) {
          tracker.fail("prepare", getEarnPrepareLifecycleDiagnostics(error));
        } else if (phase === "prepare") {
          tracker.fail("prepare", { errorCode: "unexpected_error" });
        } else {
          tracker.fail("wallet_submit_confirm", {
            errorCode: "unexpected_error",
          });
        }
        const loadingFailurePhase = resolveBrowserLoadingFailurePhase({
          previewMetricSent,
          walletSubmitted: walletSubmittedAtMs !== null,
        });
        if (loadingFailurePhase === "interaction_to_preview") {
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.deposit",
            outcome: "failed",
            phase: loadingFailurePhase,
            presentation: hasPosition ? "wallet" : "in_app",
            startedAtMs: interactionStartedAtMs,
          });
        } else if (loadingFailurePhase === "wallet_confirmation_to_ui") {
          captureBrowserSubmittedFailureMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.deposit",
            startedAtMs: walletSubmittedAtMs,
          });
        }
        if (!isWalletCancellation(error)) {
          earnToast.error("Deposit failed");
        }
        return false;
      } finally {
        setIsDepositPending(false);
        earnToast.settle();
      }
    },
    [
      canMutateAccount,
      connection.rpcEndpoint,
      debitMainAccountUsdcBalance,
      depositSource,
      ensureCanSignAccountAction,
      expectEarnTransaction,
      hasPosition,
      openSignIn,
      registerExpectedEarnMutation,
      requestApproval,
      setPosition,
      smartAccountData,
      suppressPositionRefreshThroughSlot,
      trackedKaminoUsdcMint,
      wallet.signAllTransactions,
    ]
  );

  // ---- Withdraw (app-wallet-workspace.tsx:5334-5473 + 5845-6054) ----
  const withdrawSources = useMemo(
    () => createWithdrawSourceOptions(position?.holdings),
    [position?.holdings]
  );

  const submitWithdraw = useCallback(
    async (draft: EarnWithdrawDraft): Promise<boolean> => {
      const tracker = createBrowserLifecycleTracker({
        flowName: "earn.withdrawal",
        flowVariant: draft.mode,
      });
      withdrawTrackerRef.current = tracker;
      tracker.start("intent", { cleanupRequired: draft.mode === "full" });
      setWithdrawError(null);
      setIsWithdrawPending(true);
      earnToast.begin("withdraw");
      earnToast.loading("Preparing withdrawal");
      const interactionStartedAtMs = getBrowserPerformanceNow();
      let previewMetricSent = false;
      let walletSubmittedAtMs: number | null = null;
      const markWalletSubmitted = () => {
        walletSubmittedAtMs ??= getBrowserPerformanceNow();
      };

      try {
        tracker.observe("prepare", {
          cleanupRequired: draft.mode === "full",
        });
        const amountRaw = getEarnWithdrawDraftAmountRaw(draft);
        let preparedWithdraw = await measureBrowserLoadingDependencies({
          flowId: tracker.flowId,
          operation: "earn.withdrawal",
          rpcEndpoint: connection.rpcEndpoint,
          run: () => prepareEarnWithdrawInBrowser(draft, tracker.flowId),
        });
        const shouldBypassWithdrawPreview =
          draft.mode === "partial" &&
          !preparedWithdraw.autodepositClosePrepared;

        // Only full withdrawals gate on the approval sheet; partials skip
        // it even when they carry an autodeposit close — the wallet still
        // prompts per signature.
        if (draft.mode === "full") {
          earnToast.loading("Waiting for approval");
          const approvalPromise = requestApproval(
            buildEarnWithdrawReviewItem({
              draft,
              hasAutodepositTeardown: Boolean(
                preparedWithdraw.autodepositClosePrepared
              ),
              preparedWithdraw,
            })
          );
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.withdrawal",
            phase: "interaction_to_preview",
            presentation: "in_app",
            startedAtMs: interactionStartedAtMs,
          });
          previewMetricSent = true;
          const approved = await approvalPromise;
          if (!approved) {
            tracker.cancel("wallet_submit_confirm", {
              errorCode: "wallet_rejected",
            });
            withdrawTrackerRef.current = null;
            return false;
          }
        } else {
          captureBrowserLoadingMetric({
            durationMs: Math.max(
              0,
              getBrowserPerformanceNow() - interactionStartedAtMs
            ),
            flowId: tracker.flowId,
            operation: "earn.withdrawal",
            phase: "interaction_to_preview",
            presentation: "wallet",
          });
          previewMetricSent = true;
        }

        if (!ensureCanSignAccountAction()) {
          return false;
        }
        earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);

        if (shouldBypassWithdrawPreview) {
          const stepCount = Math.max(1, preparedWithdraw.withdrawSteps.length);
          let confirmationRecordFailed = false;
          let latestConfirmedSlot: string | undefined;
          let latestSignature: string | undefined;
          for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
            tracker.observe("wallet_submit_confirm", {
              chainState: "submitted",
              executionMode: stepCount > 1 ? "sequential" : "single",
              stageCount: stepCount,
              stageIndex: stepIndex,
            });
            earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);
            const result = await smartAccountData.executeEarnWithdraw({
              amountRaw,
              mode: draft.mode,
              observabilityFlowId: tracker.flowId,
              onWalletSubmitted: markWalletSubmitted,
              preparedWithdraw,
              stepIndex,
            });
            if (!result.success) {
              throw new Error(result.error ?? "Earn withdrawal failed.");
            }
            confirmationRecordFailed ||=
              result.status === "confirmation_record_failed";
            latestConfirmedSlot = result.confirmedSlot ?? latestConfirmedSlot;
            latestSignature = result.signature ?? latestSignature;
          }

          tracker.observe("slot_resolve", { chainState: "confirmed" });
          tracker.observe("backend_confirm", {
            chainState: "confirmed",
            persistenceState: confirmationRecordFailed ? "failed" : "recorded",
          });
          registerExpectedEarnMutation({
            operation: "withdraw_partial",
            resources: EARN_BALANCE_MUTATION_RESOURCES,
            signature: latestSignature,
          });
          expectEarnTransaction(latestSignature);
          setPosition((current) =>
            applySubmittedEarnWithdrawToPosition({ amountRaw, current, draft })
          );
          if (draft.source.liquidityMint === trackedKaminoUsdcMint) {
            creditMainAccountUsdcBalance(amountRaw);
          }
          suppressPositionRefreshThroughSlot(latestConfirmedSlot);
          if (walletSubmittedAtMs !== null) {
            captureBrowserLoadingMetricAfterPaint({
              flowId: tracker.flowId,
              operation: "earn.withdrawal",
              phase: "wallet_confirmation_to_ui",
              startedAtMs: walletSubmittedAtMs,
            });
          }
          tracker.complete("ui_commit", {
            chainState: "confirmed",
            persistenceState: confirmationRecordFailed ? "failed" : "recorded",
          });
          if (confirmationRecordFailed) {
            setWithdrawError(EARN_WITHDRAW_CONFIRMED_BUT_NOT_RECORDED_MESSAGE);
            tracker.recovery({ errorCode: "record_failed" });
          }
          withdrawTrackerRef.current = null;
          earnToast.success("Withdrawn");
          return true;
        }

        // Staged path (full withdrawals, or a partial that carries an
        // autodeposit close). The old workspace signs one stage per review
        // click; the facelift chains the stages.
        let stage: EarnWithdrawReviewStage =
          preparedWithdraw.autodepositClosePrepared
            ? "autodeposit"
            : "withdraw-0";
        let confirmationRecordFailed = false;
        for (;;) {
          if (stage === "autodeposit") {
            tracker.observe("autodeposit_close", {
              autodepositCloseRequired: true,
              chainState: "not_submitted",
            });
            tracker.observe("wallet_submit_confirm", {
              autodepositCloseRequired: true,
              chainState: "submitted",
              executionMode: "sequential",
            });
            const preparedClose =
              preparedWithdraw.autodepositClosePrepared ?? null;
            if (!preparedClose) {
              throw new Error("Prepare the Autodeposit close before signing.");
            }
            earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);
            const result = await smartAccountData.executeEarnAutodepositClose({
              observabilityFlowId: tracker.flowId,
              onWalletSubmitted: markWalletSubmitted,
              policy: preparedClose.policy.account.toBase58(),
              preparedClose,
              recurringDelegation:
                preparedClose.subscription.recurringDelegation.toBase58(),
            });
            if (!result.success) {
              if (result.status === "confirmation_record_failed") {
                tracker.fail("backend_confirm", {
                  chainState: "confirmed",
                  errorCode: "record_failed",
                  persistenceState: "failed",
                });
              }
              throw new Error(result.error ?? "Autodeposit close failed.");
            }
            setAutodepositOverride({ config: null });
            registerExpectedEarnMutation({
              operation: "autodeposit_close",
              resources: EARN_AUTODEPOSIT_MUTATION_RESOURCES,
              signature: result.signature,
              targetId: result.targetId,
            });
            const nextPreparedWithdraw = await prepareEarnWithdrawInBrowser(
              draft,
              tracker.flowId
            );
            if (nextPreparedWithdraw.autodepositClosePrepared) {
              throw new Error(
                "Autodeposit close was confirmed, but the refreshed Earn action still includes an Autodeposit close. Review it again before signing."
              );
            }
            preparedWithdraw = nextPreparedWithdraw;
            stage = "withdraw-0";
            continue;
          }

          const stepIndex = Number(stage.replace("withdraw-", "")) || 0;
          tracker.observe("wallet_submit_confirm", {
            chainState: "submitted",
            executionMode:
              preparedWithdraw.withdrawSteps.length > 1
                ? "sequential"
                : "single",
            stageCount: Math.max(1, preparedWithdraw.withdrawSteps.length),
            stageIndex: stepIndex,
          });
          earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);
          const result = await smartAccountData.executeEarnWithdraw({
            amountRaw,
            observabilityFlowId: tracker.flowId,
            autodepositCloseAlreadyCompleted: draft.mode === "full",
            mode: draft.mode,
            onWalletSubmitted: markWalletSubmitted,
            preparedWithdraw,
            stepIndex,
          });
          if (!result.success) {
            throw new Error(result.error ?? "Earn withdrawal failed.");
          }
          confirmationRecordFailed ||=
            result.status === "confirmation_record_failed";

          const nextStage = getNextEarnWithdrawReviewStage({
            currentStage: stage,
            hasAutodepositTeardown: Boolean(
              preparedWithdraw.autodepositClosePrepared
            ),
            preparedWithdraw,
          });
          if (nextStage !== null) {
            stage = nextStage;
            continue;
          }

          tracker.observe("slot_resolve", { chainState: "confirmed" });
          tracker.observe("backend_confirm", {
            chainState: "confirmed",
            persistenceState: confirmationRecordFailed ? "failed" : "recorded",
          });
          registerExpectedEarnMutation({
            operation:
              draft.mode === "partial" ? "withdraw_partial" : "withdraw_full",
            resources: EARN_BALANCE_MUTATION_RESOURCES,
            signature: result.signature,
          });
          expectEarnTransaction(result.signature);
          setPosition((current) =>
            applySubmittedEarnWithdrawToPosition({ amountRaw, current, draft })
          );
          if (
            draft.mode === "partial" &&
            draft.source.liquidityMint === trackedKaminoUsdcMint
          ) {
            creditMainAccountUsdcBalance(amountRaw);
            suppressPositionRefreshThroughSlot(result.confirmedSlot);
          }
          if (walletSubmittedAtMs !== null) {
            captureBrowserLoadingMetricAfterPaint({
              flowId: tracker.flowId,
              operation: "earn.withdrawal",
              phase: "wallet_confirmation_to_ui",
              startedAtMs: walletSubmittedAtMs,
            });
          }
          if (draft.mode === "full") {
            // The flow stays open: the rent-cleanup phase completes it.
            tracker.observe("full_exit_verify", {
              chainState: "confirmed",
              cleanupRequired: true,
              persistenceState: confirmationRecordFailed
                ? "failed"
                : "recorded",
            });
          } else {
            tracker.complete("ui_commit", {
              chainState: "confirmed",
              persistenceState: confirmationRecordFailed
                ? "failed"
                : "recorded",
            });
            if (confirmationRecordFailed) {
              tracker.recovery({ errorCode: "record_failed" });
            }
            withdrawTrackerRef.current = null;
          }
          if (confirmationRecordFailed) {
            setWithdrawError(EARN_WITHDRAW_CONFIRMED_BUT_NOT_RECORDED_MESSAGE);
          }
          earnToast.success("Withdrawn");
          return true;
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to prepare Earn withdrawal.";
        setWithdrawError(message);
        if (isWalletCancellation(error)) {
          tracker.cancel("wallet_submit_confirm", {
            errorCode: "wallet_rejected",
          });
        } else if (error instanceof EarnPrepareRequestError) {
          tracker.fail("prepare", getEarnPrepareLifecycleDiagnostics(error));
        } else {
          tracker.fail("wallet_submit_confirm", {
            errorCode: "unexpected_error",
          });
        }
        const loadingFailurePhase = resolveBrowserLoadingFailurePhase({
          previewMetricSent,
          walletSubmitted: walletSubmittedAtMs !== null,
        });
        if (loadingFailurePhase === "interaction_to_preview") {
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.withdrawal",
            outcome: "failed",
            phase: loadingFailurePhase,
            presentation: draft.mode === "full" ? "in_app" : "wallet",
            startedAtMs: interactionStartedAtMs,
          });
        } else if (loadingFailurePhase === "wallet_confirmation_to_ui") {
          captureBrowserSubmittedFailureMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.withdrawal",
            startedAtMs: walletSubmittedAtMs,
          });
        }
        if (!isWalletCancellation(error)) {
          earnToast.error("Withdrawal failed");
        }
        return false;
      } finally {
        setIsWithdrawPending(false);
        earnToast.settle();
      }
    },
    [
      creditMainAccountUsdcBalance,
      connection.rpcEndpoint,
      ensureCanSignAccountAction,
      expectEarnTransaction,
      prepareEarnWithdrawInBrowser,
      registerExpectedEarnMutation,
      requestApproval,
      setAutodepositOverride,
      setPosition,
      smartAccountData,
      suppressPositionRefreshThroughSlot,
      trackedKaminoUsdcMint,
    ]
  );

  // ---- Cleanup phase (app-wallet-workspace.tsx:5475-5506 + 6056-6132) ----
  const cleanupCandidate = hasEarnCleanupCandidate({
    hasEarnPolicy: Boolean(smartAccountData.earnPolicy),
    hasEarnPosition: hasPosition,
  });
  const runCleanup = useCallback(async (): Promise<boolean> => {
    // ponytail: the monolith splits prepare ("Close policies") and sign
    // (review approve) into two clicks; one button covers both here.
    const tracker =
      withdrawTrackerRef.current ??
      createBrowserLifecycleTracker({
        flowName: "earn.withdrawal",
        flowVariant: "full",
      });
    if (!withdrawTrackerRef.current) {
      withdrawTrackerRef.current = tracker;
      tracker.start("intent", { cleanupRequired: true });
    }
    const interactionStartedAtMs = getBrowserPerformanceNow();
    let previewMetricSent = false;
    let walletSubmittedAtMs: number | null = null;
    const markWalletSubmitted = () => {
      walletSubmittedAtMs ??= getBrowserPerformanceNow();
    };
    setWithdrawError(null);
    setIsCleanupPending(true);
    earnToast.begin("close-policies");
    earnToast.loading("Closing policies");
    try {
      tracker.observe("full_exit_verify", {
        chainState: "confirmed",
        cleanupRequired: true,
      });
      let preparedCleanup;
      try {
        preparedCleanup = await measureBrowserLoadingDependencies({
          flowId: tracker.flowId,
          operation: "earn.close",
          rpcEndpoint: connection.rpcEndpoint,
          run: () =>
            prepareEarnCleanupOnServer({
              observabilityFlowId: tracker.flowId,
            }),
        });
      } catch (error) {
        tracker.fail("full_exit_verify", {
          errorCode: "full_exit_verification_retryable",
        });
        throw error instanceof Error
          ? error
          : new Error("Failed to prepare Earn cleanup.");
      }

      captureBrowserLoadingMetric({
        durationMs: Math.max(
          0,
          getBrowserPerformanceNow() - interactionStartedAtMs
        ),
        flowId: tracker.flowId,
        operation: "earn.close",
        phase: "interaction_to_preview",
        presentation: "wallet",
      });
      previewMetricSent = true;

      if (!ensureCanSignAccountAction()) {
        return false;
      }
      tracker.observe("cleanup", {
        chainState: "submitted",
        cleanupRequired: true,
      });
      earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);
      const result = await smartAccountData.executeEarnCleanup({
        observabilityFlowId: tracker.flowId,
        onWalletSubmitted: markWalletSubmitted,
        preparedCleanup,
      });
      if (!result.success) {
        if (result.status === "confirmation_record_failed") {
          tracker.fail("cleanup", {
            chainState: "confirmed",
            errorCode: "record_failed",
            persistenceState: "failed",
          });
        }
        throw new Error(result.error ?? "Earn cleanup failed.");
      }

      setPosition(null);
      setAutodepositOverride({ config: null });
      registerExpectedEarnMutation({
        operation: "cleanup",
        resources: EARN_CLEANUP_MUTATION_RESOURCES,
        signature: result.signature,
      });
      if (walletSubmittedAtMs !== null) {
        captureBrowserLoadingMetricAfterPaint({
          flowId: tracker.flowId,
          operation: "earn.close",
          phase: "wallet_confirmation_to_ui",
          startedAtMs: walletSubmittedAtMs,
        });
      }
      tracker.complete("ui_commit", {
        chainState: "confirmed",
        cleanupRequired: true,
        persistenceState: "recorded",
      });
      withdrawTrackerRef.current = null;
      earnToast.success("Policies closed");
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Earn cleanup failed.";
      setWithdrawError(message);
      if (isWalletCancellation(error)) {
        tracker.cancel("cleanup", { errorCode: "wallet_rejected" });
      } else {
        earnToast.error("Couldn't close policies");
      }
      const loadingFailurePhase = resolveBrowserLoadingFailurePhase({
        previewMetricSent,
        walletSubmitted: walletSubmittedAtMs !== null,
      });
      if (loadingFailurePhase === "interaction_to_preview") {
        captureBrowserLoadingMetricAfterPaint({
          flowId: tracker.flowId,
          operation: "earn.close",
          outcome: "failed",
          phase: loadingFailurePhase,
          presentation: "wallet",
          startedAtMs: interactionStartedAtMs,
        });
      } else if (loadingFailurePhase === "wallet_confirmation_to_ui") {
        captureBrowserSubmittedFailureMetricAfterPaint({
          flowId: tracker.flowId,
          operation: "earn.close",
          startedAtMs: walletSubmittedAtMs,
        });
      }
      return false;
    } finally {
      setIsCleanupPending(false);
      earnToast.settle();
    }
  }, [
    connection.rpcEndpoint,
    ensureCanSignAccountAction,
    registerExpectedEarnMutation,
    setAutodepositOverride,
    setPosition,
    smartAccountData,
  ]);

  // ---- Autodeposit save (app-wallet-workspace.tsx:4411-4602 + 6134-6395) ----
  const saveAutodeposit = useCallback(
    async (keepAmountLabel: string): Promise<boolean> => {
      if (autodepositFloorInFlightRef.current) {
        return false;
      }
      if (!canMutateAccount) {
        openSignIn();
        return false;
      }
      const source = depositSource;

      const amountLabel =
        autodepositConfig?.amount ?? DEFAULT_EARN_AUTODEPOSIT_AMOUNT_LABEL;
      const normalizedKeepAmount = Number(
        (keepAmountLabel || "0").replace(/,/g, "")
      );
      if (!Number.isFinite(normalizedKeepAmount) || normalizedKeepAmount < 0) {
        setAutodepositError("Enter an Autodeposit minimum balance.");
        return false;
      }

      let amountRaw: bigint;
      let keepAmountRaw: bigint;
      try {
        amountRaw = parseTokenAmountLabelToRaw(amountLabel, source.decimals);
        keepAmountRaw = parseTokenAmountLabelToRaw(
          keepAmountLabel || "0",
          source.decimals
        );
      } catch (error) {
        setAutodepositError(
          error instanceof Error
            ? error.message.replaceAll("autodeposit", "Autodeposit")
            : "Enter valid Autodeposit amounts."
        );
        return false;
      }

      const currentAmountRaw = autodepositConfig
        ? parseTokenAmountLabelToRaw(autodepositConfig.amount, source.decimals)
        : null;
      const currentKeepAmountRaw = autodepositConfig
        ? parseTokenAmountLabelToRaw(
            autodepositConfig.keepAmount,
            source.decimals
          )
        : null;
      const amountChanged =
        currentAmountRaw === null || currentAmountRaw !== amountRaw;
      const keepAmountChanged =
        currentKeepAmountRaw === null || currentKeepAmountRaw !== keepAmountRaw;
      const canUseFloorUpdate =
        autodepositConfig?.state === "created" ||
        autodepositConfig?.state === "paused";
      const isPendingSetup =
        autodepositConfig?.state === "creating" &&
        Boolean(autodepositConfig.policyAccount);

      if (
        autodepositConfig &&
        !isPendingSetup &&
        !amountChanged &&
        !keepAmountChanged
      ) {
        setAutodepositError("No Autodeposit changes to save.");
        return false;
      }
      setAutodepositError(null);

      // Floor-only change on a live rule: off-chain rebaseline, no signature.
      if (
        canUseFloorUpdate &&
        autodepositConfig &&
        !amountChanged &&
        keepAmountChanged
      ) {
        if (
          !(
            autodepositConfig.policyAccount &&
            autodepositConfig.recurringDelegation
          )
        ) {
          setAutodepositError("Autodeposit account metadata is missing.");
          return false;
        }
        const tracker = createBrowserLifecycleTracker({
          flowName: "earn.autodeposit.configuration",
          flowVariant: "floor_update",
        });
        autodepositTrackerRef.current = tracker;
        tracker.start("intent");
        tracker.observe("prepare");
        autodepositFloorInFlightRef.current = true;
        setIsAutodepositPending(true);
        earnToast.loading("Updating Autodeposit");
        try {
          const result =
            await smartAccountData.executeEarnAutodepositFloorUpdate({
              observabilityFlowId: tracker.flowId,
              policyAccount: autodepositConfig.policyAccount,
              recurringDelegation: autodepositConfig.recurringDelegation,
              walletBalanceFloorRaw: keepAmountRaw,
            });
          if (!result.success) {
            tracker.fail("backend_confirm", {
              errorCode: "record_failed",
              persistenceState: "failed",
            });
            setAutodepositError(
              result.error ?? "Autodeposit wallet balance floor update failed."
            );
            earnToast.error("Couldn't save Autodeposit");
            return false;
          }
          setAutodepositOverride({
            config: {
              ...autodepositConfig,
              keepAmount: keepAmountLabel,
              scheduledSweeps: result.scheduledSweeps ?? [],
            },
          });
          registerExpectedEarnMutation({
            operation: "autodeposit_floor",
            resources: EARN_AUTODEPOSIT_MUTATION_RESOURCES,
            targetId: result.target?.id,
          });
          tracker.complete("ui_commit", { persistenceState: "recorded" });
          earnToast.success("Autodeposit updated");
          return true;
        } finally {
          autodepositFloorInFlightRef.current = false;
          setIsAutodepositPending(false);
          earnToast.settle();
        }
      }

      // Signature path: create, or resume a pending setup.
      const existingPolicySeed =
        autodepositConfig?.policySeed || autodepositConfig?.nonce || undefined;
      const draftNonce =
        (autodepositConfig?.setupNonce &&
        /^\d+$/.test(autodepositConfig.setupNonce)
          ? BigInt(autodepositConfig.setupNonce)
          : undefined) ?? BigInt(Date.now());
      const expiryTimestamp =
        autodepositConfig?.expiryTimestamp &&
        /^\d+$/.test(autodepositConfig.expiryTimestamp)
          ? BigInt(autodepositConfig.expiryTimestamp)
          : undefined;
      const periodLengthSeconds =
        autodepositConfig?.periodLengthSeconds &&
        /^\d+$/.test(autodepositConfig.periodLengthSeconds)
          ? BigInt(autodepositConfig.periodLengthSeconds)
          : undefined;
      const startTimestamp =
        autodepositConfig?.startTimestamp &&
        /^\d+$/.test(autodepositConfig.startTimestamp)
          ? BigInt(autodepositConfig.startTimestamp)
          : undefined;

      if (!ensureCanSignAccountAction()) {
        return false;
      }

      const previousConfig = autodepositConfig;
      const tracker = createBrowserLifecycleTracker({
        flowName: "earn.autodeposit.configuration",
        flowVariant: "setup",
      });
      autodepositTrackerRef.current = tracker;
      tracker.start("intent");
      tracker.observe("prepare");
      const interactionStartedAtMs = getBrowserPerformanceNow();
      let previewMetricSent = false;
      let walletSubmittedAtMs: number | null = null;
      const markWalletSubmitted = () => {
        walletSubmittedAtMs ??= getBrowserPerformanceNow();
      };

      const setupReviewDraft: EarnAutodepositDraft = {
        amount: Number(amountLabel.replace(/,/g, "")) || 0,
        amountLabel,
        amountChanged,
        keepAmount: normalizedKeepAmount,
        keepAmountChanged,
        keepAmountLabel: keepAmountLabel || "0",
        nonce: draftNonce,
        requiresSignature: true,
        source,
        symbol: "USDC",
        tokenDecimals: source.decimals,
      };
      earnToast.begin("autodeposit-setup");
      earnToast.loading("Waiting for approval");
      const approvalPromise = requestApproval(
        buildEarnAutodepositSetupReviewItem({ draft: setupReviewDraft })
      );
      captureBrowserLoadingMetricAfterPaint({
        flowId: tracker.flowId,
        operation: "earn.autodeposit.setup",
        phase: "interaction_to_preview",
        presentation: "in_app",
        startedAtMs: interactionStartedAtMs,
      });
      previewMetricSent = true;
      const setupApproved = await approvalPromise;
      if (!setupApproved) {
        tracker.cancel("wallet_approval", { errorCode: "wallet_rejected" });
        autodepositTrackerRef.current = null;
        earnToast.settle();
        return false;
      }

      setAutodepositOverride({
        config: previousConfig
          ? { ...previousConfig, state: "creating" }
          : {
              amount: amountLabel,
              depositedAmount: "0",
              expiryTimestamp: expiryTimestamp?.toString() ?? null,
              keepAmount: keepAmountLabel,
              nextPeriodLabel: null,
              nonce: draftNonce.toString(),
              periodLengthSeconds: periodLengthSeconds?.toString() ?? null,
              policyAccount: "",
              policySeed: "",
              recurringDelegation: "",
              scheduledSweeps: [],
              setupNonce: draftNonce.toString(),
              startTimestamp: startTimestamp?.toString() ?? null,
              state: "creating",
            },
      });
      setIsAutodepositPending(true);
      earnToast.loading("Preparing Autodeposit");

      try {
        let preparedSetup = null as Awaited<
          ReturnType<typeof smartAccountData.prepareEarnAutodepositSetup>
        > | null;
        for (;;) {
          if (!preparedSetup) {
            preparedSetup = await measureBrowserLoadingDependencies({
              flowId: tracker.flowId,
              operation: "earn.autodeposit.setup",
              rpcEndpoint: connection.rpcEndpoint,
              run: () =>
                smartAccountData.prepareEarnAutodepositSetup({
                  amountRaw,
                  expiryTimestamp,
                  nonce: draftNonce,
                  periodLengthSeconds,
                  policySeed: existingPolicySeed
                    ? BigInt(existingPolicySeed)
                    : undefined,
                  startTimestamp,
                  walletBalanceFloorRaw: keepAmountRaw,
                }),
            });
          }
          tracker.observe(
            preparedSetup.stage === "create_policy"
              ? "create_policy"
              : "create_recurring_delegation",
            { chainState: "not_submitted" }
          );
          tracker.observe("wallet_approval", {
            chainState: "submitted",
            executionMode: "sequential",
          });
          earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);
          const result = await smartAccountData.executeEarnAutodepositSetup({
            amountRaw,
            observabilityFlowId: tracker.flowId,
            onWalletSubmitted: markWalletSubmitted,
            expiryTimestamp,
            nonce: draftNonce,
            periodLengthSeconds,
            policySeed: existingPolicySeed
              ? BigInt(existingPolicySeed)
              : undefined,
            preparedSetup,
            startTimestamp,
            walletBalanceFloorRaw: keepAmountRaw,
          });

          if (!(result.success && result.preparedSetup)) {
            if (result.status === "confirmation_record_failed") {
              tracker.fail("backend_confirm", {
                chainState: "confirmed",
                errorCode: "record_failed",
                persistenceState: "failed",
              });
            }
            throw new Error(result.error ?? "Autodeposit setup failed.");
          }

          tracker.observe("backend_confirm", {
            chainState: "confirmed",
            persistenceState: "recorded",
          });

          if (result.preparedSetup.stage !== "create_recurring_delegation") {
            if (!result.nextPreparedSetup) {
              throw new Error(
                "Failed to prepare recurring delegation approval."
              );
            }
            preparedSetup = result.nextPreparedSetup;
            continue;
          }

          const policyAccount = result.preparedSetup.persistence.policyAccount;
          if (!policyAccount) {
            throw new Error("Autodeposit policy account was not returned.");
          }
          if (result.bootstrapSweep) {
            tracker.observe("bootstrap", { persistenceState: "recorded" });
          }

          setAutodepositOverride({
            config: {
              amount: amountLabel,
              depositedAmount: previousConfig?.depositedAmount ?? "0",
              expiryTimestamp: result.preparedSetup.persistence.expiryTimestamp,
              keepAmount: keepAmountLabel,
              nextPeriodLabel: null,
              nonce:
                result.preparedSetup.persistence.policySeed ??
                result.preparedSetup.persistence.nonce,
              periodLengthSeconds:
                result.preparedSetup.persistence.periodLengthSeconds,
              policyAccount,
              policySeed:
                result.preparedSetup.persistence.policySeed ??
                result.preparedSetup.persistence.nonce,
              recurringDelegation:
                result.preparedSetup.persistence.recurringDelegation,
              scheduledSweeps: result.scheduledSweeps ?? [],
              setupNonce: result.preparedSetup.persistence.nonce,
              startTimestamp: result.preparedSetup.persistence.startTimestamp,
              state: "created",
            },
          });
          registerExpectedEarnMutation({
            operation: "autodeposit_setup",
            resources: EARN_AUTODEPOSIT_MUTATION_RESOURCES,
            signature: result.signature,
            targetId: result.targetId,
          });
          if (walletSubmittedAtMs !== null) {
            captureBrowserLoadingMetricAfterPaint({
              flowId: tracker.flowId,
              operation: "earn.autodeposit.setup",
              phase: "wallet_confirmation_to_ui",
              startedAtMs: walletSubmittedAtMs,
            });
          }
          tracker.complete("ui_commit", {
            chainState: "confirmed",
            persistenceState: "recorded",
          });
          earnToast.success(
            previousConfig ? "Autodeposit updated" : "Autodeposit created"
          );
          if (!previousConfig) {
            lifecycleOnboarding.autodepositCreated();
          }
          return true;
        }
      } catch (error) {
        setAutodepositOverride(
          previousConfig ? { config: previousConfig } : null
        );
        setAutodepositError(
          error instanceof Error
            ? error.message.replaceAll("autodeposit", "Autodeposit")
            : "Autodeposit setup failed."
        );
        if (isWalletCancellation(error)) {
          tracker.cancel("wallet_approval", { errorCode: "wallet_rejected" });
        } else if (isConfirmedSlotUnavailableError(error)) {
          // The transaction landed; only the slot probe timed out. Name the
          // real stage so alerts don't read as backend persistence failures.
          tracker.fail("slot_resolve", {
            chainState: "confirmed",
            errorCode: "slot_resolution_failed",
          });
          earnToast.error("Couldn't save Autodeposit");
        } else {
          tracker.fail("backend_confirm", { errorCode: "unexpected_error" });
          earnToast.error("Couldn't save Autodeposit");
        }
        const loadingFailurePhase = resolveBrowserLoadingFailurePhase({
          previewMetricSent,
          walletSubmitted: walletSubmittedAtMs !== null,
        });
        if (loadingFailurePhase === "interaction_to_preview") {
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.autodeposit.setup",
            outcome: "failed",
            phase: loadingFailurePhase,
            presentation: "in_app",
            startedAtMs: interactionStartedAtMs,
          });
        } else if (loadingFailurePhase === "wallet_confirmation_to_ui") {
          captureBrowserSubmittedFailureMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.autodeposit.setup",
            startedAtMs: walletSubmittedAtMs,
          });
        }
        return false;
      } finally {
        setIsAutodepositPending(false);
        earnToast.settle();
      }
    },
    [
      autodepositConfig,
      canMutateAccount,
      connection.rpcEndpoint,
      depositSource,
      ensureCanSignAccountAction,
      openSignIn,
      registerExpectedEarnMutation,
      requestApproval,
      setAutodepositOverride,
      smartAccountData,
    ]
  );

  // ---- Autodeposit close (app-wallet-workspace.tsx:4621-4666 + 6407-6503) --
  const requestAutodepositClose = useCallback(() => {
    if (
      !autodepositConfig ||
      (autodepositConfig.state !== "created" &&
        autodepositConfig.state !== "paused")
    ) {
      return;
    }
    setAutodepositError(null);
    setAutodepositOverride({
      config: { ...autodepositConfig, state: "closing" },
    });
    autodepositClosePreparedRef.current = null;
    const tracker = createBrowserLifecycleTracker({
      flowName: "earn.autodeposit.configuration",
      flowVariant: "close",
    });
    tracker.start("intent");
    tracker.observe("prepare");
    autodepositTrackerRef.current = tracker;
    const closeMetric = {
      previewMetricSent: false,
      startedAtMs: getBrowserPerformanceNow(),
      tracker,
    };
    autodepositCloseMetricRef.current = closeMetric;
    if (
      autodepositConfig.policyAccount &&
      autodepositConfig.recurringDelegation
    ) {
      void measureBrowserLoadingDependencies({
        flowId: tracker.flowId,
        operation: "earn.autodeposit.close",
        rpcEndpoint: connection.rpcEndpoint,
        run: () =>
          smartAccountData.prepareEarnAutodepositClose({
            policy: autodepositConfig.policyAccount,
            recurringDelegation: autodepositConfig.recurringDelegation,
          }),
      })
        .then((prepared) => {
          if (autodepositCloseMetricRef.current !== closeMetric) {
            return;
          }
          autodepositClosePreparedRef.current = prepared;
          closeMetric.previewMetricSent = true;
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.autodeposit.close",
            phase: "interaction_to_preview",
            presentation: "in_app",
            shouldCapture: () =>
              autodepositCloseMetricRef.current === closeMetric,
            startedAtMs: closeMetric.startedAtMs,
          });
        })
        .catch((error) => {
          if (autodepositCloseMetricRef.current !== closeMetric) {
            return;
          }
          tracker.fail("prepare", { errorCode: "unexpected_error" });
          captureBrowserLoadingMetricAfterPaint({
            flowId: tracker.flowId,
            operation: "earn.autodeposit.close",
            outcome: "failed",
            phase: "interaction_to_preview",
            presentation: "in_app",
            startedAtMs: closeMetric.startedAtMs,
          });
          autodepositTrackerRef.current = null;
          autodepositCloseMetricRef.current = null;
          console.warn(
            "[earn] failed to prepare Autodeposit close preview",
            error
          );
        });
    }
  }, [
    autodepositConfig,
    connection.rpcEndpoint,
    setAutodepositOverride,
    smartAccountData,
  ]);

  const dismissAutodepositClose = useCallback(() => {
    autodepositTrackerRef.current?.cancel("wallet_approval", {
      errorCode: "wallet_rejected",
    });
    autodepositTrackerRef.current = null;
    autodepositCloseMetricRef.current = null;
    autodepositClosePreparedRef.current = null;
    setAutodepositOverride((current) =>
      current?.config?.state === "closing"
        ? { config: { ...current.config, state: "created" } }
        : current
    );
  }, [setAutodepositOverride]);

  const confirmAutodepositClose = useCallback(async (): Promise<boolean> => {
    const config = autodepositConfig;
    if (!config) {
      setAutodepositError("No Autodeposit rule is configured.");
      return false;
    }
    if (!(config.policyAccount && config.recurringDelegation)) {
      setAutodepositError("Autodeposit account metadata is missing.");
      return false;
    }
    if (!ensureCanSignAccountAction()) {
      return false;
    }

    const previousConfig = config;
    const existingMetric = autodepositCloseMetricRef.current;
    const tracker =
      existingMetric?.tracker ??
      createBrowserLifecycleTracker({
        flowName: "earn.autodeposit.configuration",
        flowVariant: "close",
      });
    const closeMetric: {
      previewMetricSent: boolean;
      startedAtMs: number;
      tracker: LifecycleTracker;
    } = existingMetric ?? {
      previewMetricSent: false,
      startedAtMs: getBrowserPerformanceNow(),
      tracker,
    };
    if (!existingMetric) {
      tracker.start("intent");
      tracker.observe("prepare");
      autodepositCloseMetricRef.current = closeMetric;
    }
    autodepositTrackerRef.current = tracker;
    let walletSubmittedAtMs: number | null = null;
    const markWalletSubmitted = () => {
      walletSubmittedAtMs ??= getBrowserPerformanceNow();
    };

    earnToast.begin("autodeposit-delete");
    earnToast.loading("Waiting for approval");
    const approvalPromise = requestApproval(
      buildEarnAutodepositCloseReviewItem({
        amountLabel: config.amount,
        preparedClose: autodepositClosePreparedRef.current,
      })
    );
    if (!closeMetric.previewMetricSent) {
      closeMetric.previewMetricSent = true;
      captureBrowserLoadingMetricAfterPaint({
        flowId: tracker.flowId,
        operation: "earn.autodeposit.close",
        phase: "interaction_to_preview",
        presentation: "in_app",
        startedAtMs: closeMetric.startedAtMs,
      });
    }
    const closeApproved = await approvalPromise;
    if (!closeApproved) {
      tracker.cancel("wallet_approval", { errorCode: "wallet_rejected" });
      autodepositTrackerRef.current = null;
      if (autodepositCloseMetricRef.current?.tracker === tracker) {
        autodepositCloseMetricRef.current = null;
      }
      earnToast.settle();
      return false;
    }

    setAutodepositError(null);
    setAutodepositOverride({ config: { ...config, state: "closing" } });
    setIsAutodepositPending(true);
    earnToast.loading(CONFIRM_IN_WALLET_MESSAGE);

    try {
      tracker.observe("wallet_approval", {
        chainState: "submitted",
        executionMode: "single",
      });
      const result = await smartAccountData.executeEarnAutodepositClose({
        observabilityFlowId: tracker.flowId,
        onWalletSubmitted: markWalletSubmitted,
        policy: config.policyAccount,
        preparedClose: autodepositClosePreparedRef.current,
        recurringDelegation: config.recurringDelegation,
      });
      if (!result.success) {
        if (result.status === "confirmation_record_failed") {
          tracker.fail("backend_confirm", {
            chainState: "confirmed",
            errorCode: "record_failed",
            persistenceState: "failed",
          });
        }
        throw new Error(result.error ?? "Autodeposit close failed.");
      }
      tracker.observe("backend_confirm", {
        chainState: "confirmed",
        persistenceState: "recorded",
      });
      setAutodepositOverride({ config: null });
      autodepositClosePreparedRef.current = null;
      registerExpectedEarnMutation({
        operation: "autodeposit_close",
        resources: EARN_AUTODEPOSIT_MUTATION_RESOURCES,
        signature: result.signature,
        targetId: result.targetId,
      });
      if (walletSubmittedAtMs !== null) {
        captureBrowserLoadingMetricAfterPaint({
          flowId: tracker.flowId,
          operation: "earn.autodeposit.close",
          phase: "wallet_confirmation_to_ui",
          startedAtMs: walletSubmittedAtMs,
        });
      }
      tracker.complete("ui_commit", {
        chainState: "confirmed",
        persistenceState: "recorded",
      });
      earnToast.success("Autodeposit deleted");
      return true;
    } catch (error) {
      setAutodepositOverride({ config: previousConfig });
      setAutodepositError(
        error instanceof Error
          ? error.message.replaceAll("autodeposit", "Autodeposit")
          : "Autodeposit close failed."
      );
      if (isWalletCancellation(error)) {
        tracker.cancel("wallet_approval", { errorCode: "wallet_rejected" });
      } else {
        tracker.fail("backend_confirm", { errorCode: "unexpected_error" });
        earnToast.error("Couldn't delete Autodeposit");
      }
      const loadingFailurePhase = resolveBrowserLoadingFailurePhase({
        previewMetricSent: closeMetric.previewMetricSent,
        walletSubmitted: walletSubmittedAtMs !== null,
      });
      if (loadingFailurePhase === "interaction_to_preview") {
        captureBrowserLoadingMetricAfterPaint({
          flowId: tracker.flowId,
          operation: "earn.autodeposit.close",
          outcome: "failed",
          phase: loadingFailurePhase,
          presentation: "in_app",
          startedAtMs: closeMetric.startedAtMs,
        });
      } else if (loadingFailurePhase === "wallet_confirmation_to_ui") {
        captureBrowserSubmittedFailureMetricAfterPaint({
          flowId: tracker.flowId,
          operation: "earn.autodeposit.close",
          startedAtMs: walletSubmittedAtMs,
        });
      }
      return false;
    } finally {
      if (autodepositTrackerRef.current === tracker) {
        autodepositTrackerRef.current = null;
      }
      if (autodepositCloseMetricRef.current?.tracker === tracker) {
        autodepositCloseMetricRef.current = null;
      }
      setIsAutodepositPending(false);
      earnToast.settle();
    }
  }, [
    autodepositConfig,
    ensureCanSignAccountAction,
    registerExpectedEarnMutation,
    requestApproval,
    setAutodepositOverride,
    smartAccountData,
  ]);

  // Execute a scheduled sweep immediately (app-wallet-workspace.tsx:
  // 4750-4847). Signature-less server request; per-slot progress then arrives
  // over SSE or the fallback poll above, which also refreshes the earn
  // resources so the row resolves into the executed transaction live.
  const executeScheduledSweep = useCallback(
    async (sweep: LoadedEarnAutodepositScheduledSweep) => {
      if (autodepositFloorInFlightRef.current || isExecuteNowPending) {
        return false;
      }
      setIsExecuteNowPending(true);
      setExecuteNowError(null);
      const tracker = createBrowserLifecycleTracker({
        flowName: "earn.autodeposit.execute_now",
        flowVariant: "execute_now",
      });
      executeNowLifecycleRef.current = { scheduledSlotId: null, tracker };
      tracker.start("intent");
      const requestedSlotId = sweep.slotId ?? sweep.id ?? null;
      if (requestedSlotId) {
        setActiveScheduledSweepSlotId(requestedSlotId);
        setAutodepositProgressBySlot((current) => ({
          ...current,
          [requestedSlotId]: {
            scheduledSlotId: requestedSlotId,
            state: "requesting",
          },
        }));
      }
      try {
        const response = await fetch(
          "/api/smart-accounts/yield-optimization/autodeposit/sweeps/execute",
          {
            body: JSON.stringify({ slotId: sweep.slotId ?? sweep.id ?? null }),
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-loyal-flow-id": tracker.flowId,
            },
            method: "POST",
          }
        );
        if (!response.ok) {
          const failure = await parseEarnAutodepositExecuteError(response);
          tracker.fail("request", {
            errorCode: failure.code,
            httpStatus: response.status,
          });
          throw new Error(failure.message);
        }
        const { scheduledSlotId } = parseEarnAutodepositExecuteResponse(
          await response.json()
        );
        setActiveScheduledSweepSlotId(scheduledSlotId);
        executeNowLifecycleRef.current = { scheduledSlotId, tracker };
        tracker.observe("request", {
          executeNowState: "requested",
          httpStatus: response.status,
          scheduledSlotId,
        });
        setAutodepositProgressBySlot((current) => {
          const next = { ...current };
          if (requestedSlotId && requestedSlotId !== scheduledSlotId) {
            delete next[requestedSlotId];
          }
          next[scheduledSlotId] = mergeEarnAutodepositProgress(
            current[scheduledSlotId],
            {
              scheduledSlotId,
              state: "requested",
            }
          );
          return next;
        });
        return true;
      } catch (error) {
        tracker.fail("request", { errorCode: "request_failed" });
        setActiveScheduledSweepSlotId(null);
        if (requestedSlotId) {
          setAutodepositProgressBySlot((current) => {
            const next = { ...current };
            delete next[requestedSlotId];
            return next;
          });
        }
        setExecuteNowError(
          error instanceof Error
            ? error.message.replaceAll("autodeposit", "Autodeposit")
            : "Failed to request immediate Autodeposit execution."
        );
        return false;
      } finally {
        setIsExecuteNowPending(false);
      }
    },
    [isExecuteNowPending]
  );

  return {
    authenticatedWalletAddress,
    autodepositProgressBySlot,
    closeReconnectPrompt,
    confirmAutodepositClose,
    depositError,
    depositSource,
    dismissAutodepositClose,
    earnTransactionsRefreshKey,
    executeNowError,
    executeScheduledSweep,
    hasCleanupCandidate: cleanupCandidate,
    isAutodepositPending,
    isCleanupPending,
    isDepositPending,
    isExecuteNowPending,
    isReconnectPromptOpen,
    isWithdrawPending,
    mainUsdcAmount: mainUsdc.amount,
    refreshMainUsdcAmount,
    pendingApproval,
    pendingTransactionSignatures,
    prefetchDepositPreparation,
    requestAutodepositClose,
    runCleanup,
    saveAutodeposit,
    submitDeposit,
    submitWithdraw,
    autodepositError,
    withdrawError,
    withdrawSources,
  };
}
