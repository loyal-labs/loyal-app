"use client";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import {
  createSmartAccountVaultsClient,
  type SmartAccountPreparedEarnUsdcAutodepositClose,
  type SmartAccountPreparedEarnUsdcDeposit,
  type SmartAccountPreparedEarnUsdcWithdraw,
} from "@loyal-labs/smart-account-vaults";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  EarnDepositDraft,
  EarnDepositSourceOption,
  EarnWithdrawDraft,
  EarnWithdrawSourceOption,
} from "@/components/wallet-sidebar/earn-detail-view";
import {
  advanceEarnDepositReviewStage,
  createSubmittedEarnDepositReviewState,
  getNextEarnWithdrawReviewStage,
  type EarnWithdrawReviewStage,
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
  parseTokenAmountLabelToRaw,
  resolveActiveEarnDepositTarget,
  resolveEarnMutationSmartAccountPlan,
  resolveEarnRealtimeResources,
  selectFullExitWithdrawTargets,
  toEarnWithdrawVaultsSource,
  type EarnDepositYieldRoutingPolicy,
} from "@/components/wallet-workspace/facelift/earn-actions-support";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import {
  EarnMutationReconciliationRegistry,
  useEarnRealtime,
  type EarnExpectedMutationOperation,
} from "@/features/earn-realtime";
import { createBrowserLifecycleTracker } from "@/features/observability/client";
import type { LifecycleTracker } from "@/features/observability/lifecycle-contract";
import {
  useRealtimeResource,
  useRealtimeSync,
  useRealtimeSyncScope,
  type RealtimeResourceRefreshContext,
} from "@/features/realtime-sync";
import type { ActiveEarnPosition } from "@/hooks/use-active-earn-position";
import {
  fetchEarnEarningsRangeSet,
  invalidateEarnEarningsCache,
} from "@/hooks/use-earn-earnings";
import {
  EARN_DEPOSIT_CONFIRMED_BUT_NOT_RECORDED_MESSAGE,
  EARN_DEPOSIT_POLICY_CONFIRMED_BUT_NOT_RECORDED_MESSAGE,
  getEarnDepositUserErrorMessage,
  prepareEarnCleanupOnServer,
  type SmartAccountSidebarData,
} from "@/hooks/use-smart-account-sidebar-data";
import { useAuthCapability } from "@/lib/auth/capability";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";
import type { LoadedEarnAutodepositConfig } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
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
  earnTransactionsRefreshKey: number;
  hasCleanupCandidate: boolean;
  isAutodepositPending: boolean;
  isCleanupPending: boolean;
  isDepositPending: boolean;
  isReconnectPromptOpen: boolean;
  isWithdrawPending: boolean;
  mainUsdcAmount: number | null;
  requestAutodepositClose: () => void;
  runCleanup: () => Promise<boolean>;
  saveAutodeposit: (keepAmountLabel: string) => Promise<boolean>;
  submitDeposit: (args: {
    amountLabel: string;
    forecastApyBps: number;
  }) => Promise<boolean>;
  submitWithdraw: (draft: EarnWithdrawDraft) => Promise<boolean>;
  autodepositError: string | null;
  withdrawError: string | null;
  withdrawSources: EarnWithdrawSourceOption[];
};

// The old workspace's Earn mutation orchestration (app-wallet-workspace.tsx
// handlers) rebuilt for the facelift panes. Every executor call, precondition,
// optimistic update, observability event and refresh registration mirrors the
// monolith; the one structural change is that the review overlay's
// "Continue" clicks are auto-chained — the wallet still prompts per signature.
export function useEarnActions(deps: {
  autodepositConfig: EarnAutodepositConfigView | null;
  hasPosition: boolean;
  mainUsdc: {
    amount: number | null;
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

  const [depositError, setDepositError] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [autodepositError, setAutodepositError] = useState<string | null>(null);
  const [isDepositPending, setIsDepositPending] = useState(false);
  const [isWithdrawPending, setIsWithdrawPending] = useState(false);
  const [isCleanupPending, setIsCleanupPending] = useState(false);
  const [isAutodepositPending, setIsAutodepositPending] = useState(false);
  const withdrawTrackerRef = useRef<LifecycleTracker | null>(null);
  const autodepositTrackerRef = useRef<LifecycleTracker | null>(null);
  const autodepositClosePreparedRef =
    useRef<SmartAccountPreparedEarnUsdcAutodepositClose | null>(null);
  const autodepositFloorInFlightRef = useRef(false);

  // ---- Wallet USDC funding balance (app-wallet-workspace.tsx:1765-1805) ----
  // The ATA-read hook itself lives in use-earn-position-data so its refresh
  // can feed useSmartAccountSidebarData's onAfterTx.
  const trackedKaminoUsdcMint = useMemo(
    () => resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  const setMainUsdcAmountRaw = mainUsdc.setAmountRaw;
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
      if (!settingsPda || !walletAddress) {
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
      if (!settingsPda || !walletAddress) {
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
    if (!walletAddress || !settingsPda || !earnVaultAddress) {
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
  useEarnRealtime({
    enabled: isHydrated && hasSmartAccountSession,
    identity: earnRealtimeIdentity,
    // ponytail: sweep-progress streaming feeds the deferred Execute-now UI —
    // the batch handler below does all invalidation work.
    onInvalidation: () => {},
    onInvalidationBatch: handleEarnRealtimeInvalidationBatch,
    onCursorlessConnected: refreshAllEarnResources,
    onResyncRequired: refreshAllEarnResources,
  });

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

  // ---- Browser prepares (app-wallet-workspace.tsx:4886-5061) ----
  const prepareEarnDepositInBrowser = useCallback(
    async (
      draft: EarnDepositDraft
    ): Promise<SmartAccountPreparedEarnUsdcDeposit> => {
      const overview = smartAccountData.overview;
      const policySignerPublicKey = smartAccountData.earnPolicySignerPublicKey;

      if (!overview || !walletAddress) {
        throw new Error("Smart-account overview is not loaded yet.");
      }
      if (!smartAccountData.hasEarnStateResolved) {
        throw new Error("Earn state is still loading. Try again in a moment.");
      }
      if (!policySignerPublicKey) {
        throw new Error("Earn policy signer metadata is not loaded yet.");
      }

      const amountRaw = parseTokenAmountLabelToRaw(
        draft.amountLabel,
        draft.tokenDecimals
      );
      const cluster = resolveLoyalClusterForSolanaEnv(
        resolveSolanaEnv(publicEnv.solanaEnv)
      );
      const accountSettingsPda = new PublicKey(overview.settingsPda);
      const userWallet = new PublicKey(walletAddress);
      const policy = smartAccountData.earnPolicy;
      const onboarding = smartAccountData.earnOnboarding;
      const canResumeOnboardingPreparation =
        !policy &&
        (onboarding?.nextStep === "setup_policy" ||
          onboarding?.nextStep === "deposit");
      const onboardingPolicy =
        canResumeOnboardingPreparation &&
        onboarding?.policy?.lastSeenSignature &&
        onboarding.policy.lastSeenSlot
          ? onboarding.policy
          : null;
      const routePolicy = policy ?? onboardingPolicy;
      const routeSetupPolicy =
        policy?.setupPolicy ??
        (onboardingPolicy &&
        onboarding?.setupPolicy?.lastSeenSignature &&
        onboarding.setupPolicy.lastSeenSlot
          ? onboarding.setupPolicy
          : null);
      const yieldRoutingPolicy: EarnDepositYieldRoutingPolicy | undefined =
        routePolicy && routeSetupPolicy
          ? {
              account: new PublicKey(routePolicy.account),
              seed: BigInt(routePolicy.seed),
              setupPolicy: {
                account: new PublicKey(routeSetupPolicy.account),
                seed: BigInt(routeSetupPolicy.seed),
              },
            }
          : undefined;
      const target = routePolicy
        ? resolveActiveEarnDepositTarget(position)
        : null;
      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });

      return client.prepareEarnUsdcDeposit({
        amountRaw,
        cluster,
        feePayer: userWallet,
        initializeYieldRoutingPolicy: !yieldRoutingPolicy,
        policySigner: new PublicKey(policySignerPublicKey),
        settingsPda: accountSettingsPda,
        walletAddress: userWallet,
        ...(target ? { target } : {}),
        ...(yieldRoutingPolicy ? { yieldRoutingPolicy } : {}),
      });
    },
    [
      position,
      connection,
      publicEnv.solanaEnv,
      smartAccountData.earnOnboarding,
      smartAccountData.earnPolicy,
      smartAccountData.earnPolicySignerPublicKey,
      smartAccountData.hasEarnStateResolved,
      smartAccountData.overview,
      walletAddress,
    ]
  );

  const prepareEarnWithdrawInBrowser = useCallback(
    async (
      draft: EarnWithdrawDraft
    ): Promise<SmartAccountPreparedEarnUsdcWithdraw> => {
      const overview = smartAccountData.overview;
      const policy = smartAccountData.earnPolicy;

      if (!overview || !walletAddress) {
        throw new Error("Smart-account overview is not loaded yet.");
      }
      if (!policy) {
        throw new Error("Active Earn policy metadata is required to withdraw.");
      }

      const policySigner = policy.delegatedSigners[0];
      if (!policySigner) {
        throw new Error("Active Earn policy is missing its delegated signer.");
      }

      const source = toEarnWithdrawVaultsSource(draft.source);
      const requestedAmountRaw = getEarnWithdrawDraftAmountRaw(draft);
      const effectiveAmountRaw =
        draft.mode === "full" ? source.amountRaw : requestedAmountRaw;
      const cluster = resolveLoyalClusterForSolanaEnv(
        resolveSolanaEnv(publicEnv.solanaEnv)
      );
      const accountSettingsPda = new PublicKey(overview.settingsPda);
      const userWallet = new PublicKey(walletAddress);
      const { fullWithdrawalTargets, target } =
        selectFullExitWithdrawTargets(draft);
      const client = createSmartAccountVaultsClient({
        connection,
        programId: new PublicKey(overview.programId),
      });
      const yieldRoutingPolicy = {
        account: new PublicKey(policy.account),
        seed: BigInt(policy.seed),
        setupPolicy: policy.setupPolicy
          ? {
              account: new PublicKey(policy.setupPolicy.account),
              seed: BigInt(policy.setupPolicy.seed),
            }
          : null,
      };
      const withdrawInput = {
        amountRaw: effectiveAmountRaw,
        // Policy teardown is prepared only after the server proves the
        // post-withdraw balances at or after the confirmed withdrawal slot.
        closePoliciesOnFullWithdrawal: false,
        cluster,
        feePayer: userWallet,
        policySigner: new PublicKey(policySigner),
        settingsPda: accountSettingsPda,
        source,
        ...(target ? { target } : {}),
        ...(fullWithdrawalTargets.length > 0 ? { fullWithdrawalTargets } : {}),
        walletAddress: userWallet,
        yieldRoutingPolicy,
      };

      return draft.mode === "full"
        ? client.prepareEarnUsdcWithdraw({ ...withdrawInput, mode: "full" })
        : client.prepareEarnUsdcWithdraw({ ...withdrawInput, mode: "partial" });
    },
    [
      connection,
      publicEnv.solanaEnv,
      smartAccountData.earnPolicy,
      smartAccountData.overview,
      walletAddress,
    ]
  );

  // ---- Deposit (app-wallet-workspace.tsx:5165-5332 + 5508-5843) ----
  const submitDeposit = useCallback(
    async (args: {
      amountLabel: string;
      forecastApyBps: number;
    }): Promise<boolean> => {
      if (!canMutateAccount) {
        openSignIn();
        return false;
      }

      const draft: EarnDepositDraft = {
        amount: Number(args.amountLabel.replace(/,/g, "")) || 0,
        amountLabel: args.amountLabel,
        forecastApyBps: args.forecastApyBps,
        source: depositSource,
        symbol: "USDC",
        tokenDecimals: depositSource.decimals,
        tokenMint: depositSource.mint,
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
      let phase: "prepare" | "sign" = "prepare";

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
        setPosition((current) =>
          buildPostDepositEarnPosition({
            amountRaw: commit.amountRaw,
            confirmedSlot: commit.result.confirmedSlot,
            current,
            preparedDeposit: commit.preparedDeposit,
          })
        );
        debitMainAccountUsdcBalance(commit.amountRaw);
        suppressPositionRefreshThroughSlot(commit.result.confirmedSlot);
        tracker.complete("ui_commit", {
          chainState: "confirmed",
          persistenceState:
            commit.result.status === "confirmation_record_failed"
              ? "failed"
              : "recorded",
        });
      };

      try {
        tracker.observe("prepare", {
          policyMode: requiresPolicySetup ? "create" : "reuse",
        });
        const amountRaw = parseTokenAmountLabelToRaw(
          draft.amountLabel,
          draft.tokenDecimals
        );
        const preparedDeposit = await prepareEarnDepositInBrowser(draft);
        const shouldBypassTopUpPreview =
          hasPosition &&
          !requiresPolicySetup &&
          !preparedDeposit.policySetupPrepared &&
          !preparedDeposit.policyFinalizePrepared;
        tracker.observe("review", {
          policyMode: requiresPolicySetup ? "create" : "reuse",
          reviewBypassed: shouldBypassTopUpPreview,
        });

        if (!ensureCanSignAccountAction()) {
          return false;
        }
        phase = "sign";

        if (shouldBypassTopUpPreview) {
          tracker.observe("wallet_submit_confirm", {
            chainState: "submitted",
            executionMode: "single",
            policyMode: "reuse",
          });
          const result = await smartAccountData.executeEarnDeposit({
            amountRaw,
            observabilityFlowId: tracker.flowId,
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
            observabilityFlowId: tracker.flowId,
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
            const result = await smartAccountData.executeEarnDepositPolicyStage(
              {
                observabilityFlowId: tracker.flowId,
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
          const result = await smartAccountData.executeEarnDeposit({
            amountRaw,
            observabilityFlowId: tracker.flowId,
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
          isRentError && !haystack.includes("top up")
            ? "Stash must keep a minimum SOL balance for rent. Try a smaller amount."
            : raw
        );
        if (isWalletCancellation(error)) {
          tracker.cancel("wallet_submit_confirm", {
            errorCode: "wallet_rejected",
          });
        } else if (phase === "prepare") {
          tracker.fail("prepare", { errorCode: "unexpected_error" });
        } else {
          tracker.fail("wallet_submit_confirm", {
            errorCode: "unexpected_error",
          });
        }
        return false;
      } finally {
        setIsDepositPending(false);
      }
    },
    [
      canMutateAccount,
      debitMainAccountUsdcBalance,
      depositSource,
      ensureCanSignAccountAction,
      hasPosition,
      openSignIn,
      prepareEarnDepositInBrowser,
      registerExpectedEarnMutation,
      setPosition,
      smartAccountData,
      suppressPositionRefreshThroughSlot,
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

      try {
        tracker.observe("prepare", {
          cleanupRequired: draft.mode === "full",
        });
        const amountRaw = getEarnWithdrawDraftAmountRaw(draft);
        let preparedWithdraw = await prepareEarnWithdrawInBrowser(draft);
        const shouldBypassWithdrawPreview =
          draft.mode === "partial" &&
          !preparedWithdraw.autodepositClosePrepared;

        if (!ensureCanSignAccountAction()) {
          return false;
        }

        if (shouldBypassWithdrawPreview) {
          const stepCount = Math.max(1, preparedWithdraw.withdrawSteps.length);
          let latestConfirmedSlot: string | undefined;
          let latestSignature: string | undefined;
          for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
            tracker.observe("wallet_submit_confirm", {
              chainState: "submitted",
              executionMode: stepCount > 1 ? "sequential" : "single",
              stageCount: stepCount,
              stageIndex: stepIndex,
            });
            const result = await smartAccountData.executeEarnWithdraw({
              amountRaw,
              mode: draft.mode,
              observabilityFlowId: tracker.flowId,
              preparedWithdraw,
              stepIndex,
            });
            if (!result.success) {
              if (result.status === "confirmation_record_failed") {
                tracker.fail("backend_confirm", {
                  chainState: "confirmed",
                  errorCode: "record_failed",
                  persistenceState: "failed",
                });
              }
              throw new Error(result.error ?? "Earn withdrawal failed.");
            }
            latestConfirmedSlot = result.confirmedSlot ?? latestConfirmedSlot;
            latestSignature = result.signature ?? latestSignature;
          }

          tracker.observe("slot_resolve", { chainState: "confirmed" });
          tracker.observe("backend_confirm", {
            chainState: "confirmed",
            persistenceState: "recorded",
          });
          registerExpectedEarnMutation({
            operation: "withdraw_partial",
            resources: EARN_BALANCE_MUTATION_RESOURCES,
            signature: latestSignature,
          });
          setPosition((current) =>
            applySubmittedEarnWithdrawToPosition({ amountRaw, current, draft })
          );
          creditMainAccountUsdcBalance(amountRaw);
          suppressPositionRefreshThroughSlot(latestConfirmedSlot);
          tracker.complete("ui_commit", {
            chainState: "confirmed",
            persistenceState: "recorded",
          });
          withdrawTrackerRef.current = null;
          return true;
        }

        // Staged path (full withdrawals, or a partial that carries an
        // autodeposit close). The old workspace signs one stage per review
        // click; the facelift chains the stages.
        let stage: EarnWithdrawReviewStage =
          preparedWithdraw.autodepositClosePrepared
            ? "autodeposit"
            : "withdraw-0";
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
            const result = await smartAccountData.executeEarnAutodepositClose({
              observabilityFlowId: tracker.flowId,
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
              draft
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
          const result = await smartAccountData.executeEarnWithdraw({
            amountRaw,
            observabilityFlowId: tracker.flowId,
            autodepositCloseAlreadyCompleted: draft.mode === "full",
            mode: draft.mode,
            preparedWithdraw,
            stepIndex,
          });
          if (!result.success) {
            if (result.status === "confirmation_record_failed") {
              tracker.fail("backend_confirm", {
                chainState: "confirmed",
                errorCode: "record_failed",
                persistenceState: "failed",
              });
            }
            throw new Error(result.error ?? "Earn withdrawal failed.");
          }

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
            persistenceState: "recorded",
          });
          registerExpectedEarnMutation({
            operation:
              draft.mode === "partial" ? "withdraw_partial" : "withdraw_full",
            resources: EARN_BALANCE_MUTATION_RESOURCES,
            signature: result.signature,
          });
          setPosition((current) =>
            applySubmittedEarnWithdrawToPosition({ amountRaw, current, draft })
          );
          if (draft.mode === "partial") {
            creditMainAccountUsdcBalance(amountRaw);
            suppressPositionRefreshThroughSlot(result.confirmedSlot);
          }
          if (draft.mode === "full") {
            // The flow stays open: the rent-cleanup phase completes it.
            tracker.observe("full_exit_verify", {
              chainState: "confirmed",
              cleanupRequired: true,
              persistenceState: "recorded",
            });
          } else {
            tracker.complete("ui_commit", {
              chainState: "confirmed",
              persistenceState: "recorded",
            });
            withdrawTrackerRef.current = null;
          }
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
        } else {
          tracker.fail("wallet_submit_confirm", {
            errorCode: "unexpected_error",
          });
        }
        return false;
      } finally {
        setIsWithdrawPending(false);
      }
    },
    [
      creditMainAccountUsdcBalance,
      ensureCanSignAccountAction,
      prepareEarnWithdrawInBrowser,
      registerExpectedEarnMutation,
      setAutodepositOverride,
      setPosition,
      smartAccountData,
      suppressPositionRefreshThroughSlot,
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
    const tracker = withdrawTrackerRef.current;
    setWithdrawError(null);
    setIsCleanupPending(true);
    try {
      tracker?.observe("full_exit_verify", {
        chainState: "confirmed",
        cleanupRequired: true,
      });
      let preparedCleanup;
      try {
        preparedCleanup = await prepareEarnCleanupOnServer({
          observabilityFlowId: tracker?.flowId,
        });
      } catch (error) {
        tracker?.fail("full_exit_verify", {
          errorCode: "full_exit_verification_retryable",
        });
        throw error instanceof Error
          ? error
          : new Error("Failed to prepare Earn cleanup.");
      }

      if (!ensureCanSignAccountAction()) {
        return false;
      }
      tracker?.observe("cleanup", {
        chainState: "submitted",
        cleanupRequired: true,
      });
      const result = await smartAccountData.executeEarnCleanup({
        observabilityFlowId: tracker?.flowId,
        preparedCleanup,
      });
      if (!result.success) {
        if (result.status === "confirmation_record_failed") {
          tracker?.fail("cleanup", {
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
      tracker?.complete("ui_commit", {
        chainState: "confirmed",
        cleanupRequired: true,
        persistenceState: "recorded",
      });
      withdrawTrackerRef.current = null;
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Earn cleanup failed.";
      setWithdrawError(message);
      if (isWalletCancellation(error)) {
        tracker?.cancel("cleanup", { errorCode: "wallet_rejected" });
      }
      return false;
    } finally {
      setIsCleanupPending(false);
    }
  }, [
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
          !autodepositConfig.policyAccount ||
          !autodepositConfig.recurringDelegation
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
          return true;
        } finally {
          autodepositFloorInFlightRef.current = false;
          setIsAutodepositPending(false);
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

      try {
        let preparedSetup = null as Awaited<
          ReturnType<typeof smartAccountData.prepareEarnAutodepositSetup>
        > | null;
        for (;;) {
          if (!preparedSetup) {
            preparedSetup = await smartAccountData.prepareEarnAutodepositSetup({
              amountRaw,
              expiryTimestamp,
              nonce: draftNonce,
              periodLengthSeconds,
              policySeed: existingPolicySeed
                ? BigInt(existingPolicySeed)
                : undefined,
              startTimestamp,
              walletBalanceFloorRaw: keepAmountRaw,
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
          const result = await smartAccountData.executeEarnAutodepositSetup({
            amountRaw,
            observabilityFlowId: tracker.flowId,
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

          if (!result.success || !result.preparedSetup) {
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
          tracker.complete("ui_commit", {
            chainState: "confirmed",
            persistenceState: "recorded",
          });
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
        } else {
          tracker.fail("backend_confirm", { errorCode: "unexpected_error" });
        }
        return false;
      } finally {
        setIsAutodepositPending(false);
      }
    },
    [
      autodepositConfig,
      canMutateAccount,
      depositSource,
      ensureCanSignAccountAction,
      openSignIn,
      registerExpectedEarnMutation,
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
    if (
      autodepositConfig.policyAccount &&
      autodepositConfig.recurringDelegation
    ) {
      void smartAccountData
        .prepareEarnAutodepositClose({
          policy: autodepositConfig.policyAccount,
          recurringDelegation: autodepositConfig.recurringDelegation,
        })
        .then((prepared) => {
          autodepositClosePreparedRef.current = prepared;
        })
        .catch((error) => {
          console.warn(
            "[earn] failed to prepare Autodeposit close preview",
            error
          );
        });
    }
  }, [autodepositConfig, setAutodepositOverride, smartAccountData]);

  const dismissAutodepositClose = useCallback(() => {
    autodepositTrackerRef.current?.cancel("wallet_approval", {
      errorCode: "wallet_rejected",
    });
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
    if (!config.policyAccount || !config.recurringDelegation) {
      setAutodepositError("Autodeposit account metadata is missing.");
      return false;
    }
    if (!ensureCanSignAccountAction()) {
      return false;
    }

    const previousConfig = config;
    const tracker = createBrowserLifecycleTracker({
      flowName: "earn.autodeposit.configuration",
      flowVariant: "close",
    });
    autodepositTrackerRef.current = tracker;
    tracker.start("intent");
    tracker.observe("prepare");
    setAutodepositError(null);
    setAutodepositOverride({ config: { ...config, state: "closing" } });
    setIsAutodepositPending(true);

    try {
      tracker.observe("wallet_approval", {
        chainState: "submitted",
        executionMode: "single",
      });
      const result = await smartAccountData.executeEarnAutodepositClose({
        observabilityFlowId: tracker.flowId,
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
      tracker.complete("ui_commit", {
        chainState: "confirmed",
        persistenceState: "recorded",
      });
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
      }
      return false;
    } finally {
      setIsAutodepositPending(false);
    }
  }, [
    autodepositConfig,
    ensureCanSignAccountAction,
    registerExpectedEarnMutation,
    setAutodepositOverride,
    smartAccountData,
  ]);

  return {
    authenticatedWalletAddress,
    closeReconnectPrompt,
    confirmAutodepositClose,
    depositError,
    depositSource,
    dismissAutodepositClose,
    earnTransactionsRefreshKey,
    hasCleanupCandidate: cleanupCandidate,
    isAutodepositPending,
    isCleanupPending,
    isDepositPending,
    isReconnectPromptOpen,
    isWithdrawPending,
    mainUsdcAmount: mainUsdc.amount,
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
