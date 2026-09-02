import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert } from "react-native";

import { nudgeQuestProgressCheck } from "@/components/quests/QuestCompletionWatcher";
import { useEarnActivity } from "@/hooks/wallet/useEarnActivity";
import { useEarnAutodeposit } from "@/hooks/wallet/useEarnAutodeposit";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletAutoRefresh } from "@/hooks/wallet/useWalletAutoRefresh";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import {
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import {
  executeEarnAutodepositClose,
  executeEarnAutodepositScheduledSweep,
} from "@/lib/solana/earn/autodeposit";
import {
  EarnApiError,
  fetchEarnAutodepositSweepProgress,
  type EarnAutodepositScheduledSweep,
  type EarnAutodepositSweepProgressState,
  type EarnRefundPrepareRequest,
  type EarnTransactionItem,
} from "@/lib/solana/earn/earn-api";
import { executeEarnRefund, scanEarnRefunds } from "@/lib/solana/earn/refund";
import {
  EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW,
  getVisibleEarnScheduledSweeps,
  isScheduledSweepDue,
} from "@/lib/solana/earn/earn-scheduled-sweep";
import { earnTransactionTimestampMs } from "@/lib/solana/earn/earn-tx-display";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import type { LifecycleFlow } from "@/services/observability";
import { startMobileLoadingMetric } from "@/services/loading-metrics";
import type { Transaction } from "@/types/wallet";

import {
  type ActivitySection,
  getActivityLastSeen,
  setActivityLastSeen,
} from "./activity-unread";

type ActivityContextValue = {
  walletAddress: string | null;
  walletTransactions: Transaction[];
  isFetchingTransactions: boolean;
  loadWalletTransactions: (options?: { force?: boolean }) => Promise<void>;
  earnTransactions: EarnTransactionItem[];
  isFetchingEarn: boolean;
  /** True once the first Earn-activity fetch has settled (cold load done). */
  hasLoadedEarn: boolean;
  refreshEarnTransactions: () => Promise<void>;
  /** Re-read the wallet's Autodeposit state (incl. its scheduled sweeps). */
  refreshAutodeposit: () => Promise<unknown>;
  /** Pending Autodeposit "bootstrap" sweeps awaiting their execution window. */
  earnScheduledSweeps: EarnAutodepositScheduledSweep[];
  /**
   * The backend system-paused the Autodeposit because a full withdrawal
   * closed the Earn position it sweeps into. It resumes automatically after
   * the next deposit — shown as an informational row so the user knows why
   * nothing is scheduling instead of reporting it stuck.
   */
  autodepositPausedMissingPosition: boolean;
  /** True while an "Execute now" request is in flight. */
  isExecutingSweep: boolean;
  /** Ask the worker to run the pending scheduled sweep now. */
  executeScheduledSweep: () => Promise<void>;
  /**
   * True while a just-created Autodeposit's scheduled sweep is expected to
   * appear but this provider's own Autodeposit read hasn't caught up yet — the
   * Earn feed shows a skeleton "Scheduled" row instead of nothing.
   */
  expectingScheduledSweep: boolean;
  /** Flag that a scheduled sweep is about to appear (called on Autodeposit create). */
  expectScheduledSweep: () => void;
  /**
   * An executed scheduled sweep morphing in place into its result `balance_sweep`
   * tx (or null when none is in progress). Drives the cross-fade in the Earn feed.
   */
  sweepMorph: SweepMorph | null;
  /** Drop the in-place sweep morph (called when the Activity screen blurs). */
  clearSweepMorph: () => void;
  /**
   * Granular state of the sweep currently being watched (from the progress
   * endpoint the app burst-polls after an execute), or null when nothing is
   * in flight / the backend predates the endpoint. Drives the row's
   * "Executing…" → "Depositing…" label.
   */
  sweepProgressState: EarnAutodepositSweepProgressState | null;
  /** New wallet activity since the Wallet section was last viewed. */
  walletUnread: boolean;
  /** New Earn activity since the Earn section was last viewed. */
  earnUnread: boolean;
  /** Any section has new activity — drives the bottom-nav dot. */
  anyUnread: boolean;
  /** Mark a section as seen, clearing its dot. */
  markSeen: (section: ActivitySection) => void;
  /** Refundable closed Earn accounts (empty when nothing is refundable). */
  earnRefunds: EarnRefundItem[];
  /**
   * Rent lamports the refund scan reports as blocked by the wallet's
   * Autodeposit (policy + delegation + vault buckets). Refundable only after
   * the Autodeposit is deleted — shown as an informational row so users know
   * where the SOL is instead of reporting it missing.
   */
  earnLockedRefundLamports: number;
  /** Rescan for refundable accounts; resolves to the fresh list. */
  refreshEarnRefunds: () => Promise<EarnRefundItem[]>;
  /** Account whose refund is currently in flight, or null. */
  refundingAccount: string | null;
  /** Prepare, sign and send one refund, then rescan. */
  executeRefund: (item: EarnRefundItem) => Promise<void>;
  /**
   * The locked-rent row can offer "Delete Autodeposit": the Autodeposit is
   * paused (not running, not mid-setup) and both close accounts are known.
   */
  canDeleteLockedRefundAutodeposit: boolean;
  /** True while the locked-rent row's Autodeposit delete is in flight. */
  deletingAutodeposit: boolean;
  /** Confirm, then close the paused Autodeposit so its reserved rent refunds. */
  deleteAutodepositForRefund: () => void;
};

// One refundable row in the Earn feed: a dead policy, a revoked recurring
// delegation, or the closed vault's stranded SOL + token-account rents.
export type EarnRefundItem = {
  kind: "policy" | "recurring_delegation" | "vault";
  account: string;
  lamports: number;
};

// An "Execute now" in progress, morphing in place into its result. While
// `resultTx` is null the Activity feed keeps showing the executing scheduled
// row(s) (`sweeps`, snapshotted at press time so they survive dropping out of
// the live pending list); once the worker's `balance_sweep` tx lands it's set
// here and the UI cross-fades the row to it. `baselineTxIds`/`startedAtMs` are
// how we recognise that landing tx as new.
export type SweepMorph = {
  sweeps: EarnAutodepositScheduledSweep[];
  scheduledSlotId: string;
  resultTx: EarnTransactionItem | null;
  baselineTxIds: ReadonlySet<string>;
  startedAtMs: number;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

const isBalanceSweepTx = (tx: EarnTransactionItem): boolean =>
  tx.kind === "balance_sweep" || tx.eventType === "balance_sweep";

// Cadence + bound for polling a due scheduled sweep to resolution. Short ticks so
// the row clears promptly after an execute — the server-side reconcile drops it on
// the next read once the worker has reverted/failed the slot. Capped (~40s) so a
// backend-stuck slot can't poll forever (a manual pull works after that). The
// floor on perceived latency is the worker's async revert, not this interval.
const DUE_SWEEP_POLL_MS = 2000;
const MAX_DUE_SWEEP_POLLS = 20;

// After "Execute now", the worker's resulting `balance_sweep` tx can lag behind
// the slot clearing. Poll the Earn feed for it on a short cadence so the morph
// can swap to it promptly, bounded (~60s) so a stuck/no-op execution can't poll
// forever — the executing row just lingers until a manual pull / blur.
const SWEEP_RESULT_POLL_MS = 2500;
const MAX_SWEEP_RESULT_POLLS = 24;
// Hard cap on how long a morph stays pinned (incl. after it resolves) so it
// can't hold a row out of its normal date group indefinitely if the user never
// leaves the screen.
const SWEEP_MORPH_MAX_MS = 120_000;

// Cadence + bound for the granular progress poll (the polled twin of the
// contract the web receives over SSE): a cheap single-row backend read, so it
// can tick faster than the heavy state/holdings loops above. It drives the
// row's "Executing…" → "Depositing…" label and fires the heavy refresh the
// moment the flight ends instead of waiting out the next coarse tick. Stops
// after a few misses so a backend that predates the endpoint costs nothing
// (the coarse loops above keep working unchanged as the fallback).
const SWEEP_PROGRESS_POLL_MS = 1000;
const MAX_SWEEP_PROGRESS_POLLS = 45;
const MAX_SWEEP_PROGRESS_MISSES = 3;

// The flight is over: the worker finished (or gave the slot back) and one
// immediate coarse refresh will resolve the row/morph.
const SWEEP_PROGRESS_END_STATES = new Set<EarnAutodepositSweepProgressState>([
  "completed",
  "failed",
  "canceled",
  "released",
]);

// Owns the wallet + Earn activity feeds app-wide so the bottom-nav dot stays
// live even before the Activity screen is first opened, and so the screen and
// the nav share a single fetch. Mounted once around the tab navigator.
export function ActivityProvider({ children }: { children: ReactNode }) {
  const { publicKey, signer, state } = useWallet();
  const { walletTransactions, isFetchingTransactions, loadWalletTransactions } =
    useWalletTransactions(publicKey);
  const {
    earnTransactions,
    isLoading: isFetchingEarn,
    hasLoaded: hasLoadedEarn,
    refresh: refreshEarnTransactions,
  } = useEarnActivity(publicKey);
  const {
    autodeposit,
    confirmAutodepositClose,
    refreshAutodeposit: refreshAutodepositState,
  } = useEarnAutodeposit(publicKey);

  // Keep the Earn feed warm app-wide: the hook prefetches once on mount (so the
  // data is usually ready before the user opens the Earn activity tab), and this
  // coordinator refreshes it in the background — every 15s plus on
  // focus/foreground/push — like the rest of the wallet data. The backend can be
  // slow here, so prefetching + polling avoids a long skeleton on tab open.
  useWalletAutoRefresh({
    walletAddress: publicKey,
    refresh: refreshEarnTransactions,
    intervalMs: 15_000,
  });

  // The visibility cap needs the live wallet USDC balance (see
  // getVisibleEarnScheduledSweeps) so a scheduled slot whose surplus was already
  // swept into Earn hides instead of lingering as a phantom row. Only read
  // holdings when there's actually a candidate sweep to evaluate, so passive
  // Activity views don't pay for it. Read-only (no signer) — never prompts Seed
  // Vault.
  const scheduledSweepFloorRaw =
    autodeposit?.walletBalanceFloorRaw != null &&
    /^\d+$/.test(autodeposit.walletBalanceFloorRaw)
      ? BigInt(autodeposit.walletBalanceFloorRaw)
      : null;
  const hasScheduledSweepCandidate =
    scheduledSweepFloorRaw != null &&
    (autodeposit?.scheduledSweeps ?? []).some(
      (sweep) =>
        /^\d+$/.test(sweep.remainingAmountRaw) &&
        BigInt(sweep.remainingAmountRaw) >= EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW
    );
  const { tokenHoldings, refreshTokenHoldings } = useTokenHoldings(
    hasScheduledSweepCandidate ? publicKey : null
  );
  const walletUsdcRaw = useMemo<bigint | null>(() => {
    const holding = tokenHoldings.find(
      (h) =>
        h.mint === SOLANA_USDC_MINT_MAINNET ||
        h.mint === SOLANA_USDC_MINT_DEVNET
    );
    if (!holding || !Number.isFinite(holding.balance)) {
      return null;
    }
    // ponytail: float UI balance -> raw; sub-cent rounding error sits far below
    // the 0.01 USDC visibility threshold, so it can't flip the surplus gate.
    return BigInt(Math.round(holding.balance * 10 ** holding.decimals));
  }, [tokenHoldings]);

  const earnScheduledSweeps = useMemo(
    () =>
      getVisibleEarnScheduledSweeps(
        autodeposit?.scheduledSweeps,
        walletUsdcRaw,
        scheduledSweepFloorRaw
      ),
    [autodeposit, walletUsdcRaw, scheduledSweepFloorRaw]
  );

  const autodepositPausedMissingPosition =
    autodeposit?.lifecycleStatus === "paused_missing_position";

  // Re-read Autodeposit state AND the wallet balance the surplus cap depends on.
  // The force holdings refresh is the point: after an execute the scheduled slot
  // can linger server-side, so only a fresh balance (now back at the floor) lets
  // the cap drop the row — a stale cached balance keeps showing it. No-op when
  // there's no candidate sweep (the holdings hook is idle with a null address).
  const refreshAutodeposit = useCallback(async () => {
    await Promise.all([refreshAutodepositState(), refreshTokenHoldings(true)]);
  }, [refreshAutodepositState, refreshTokenHoldings]);

  // After an execute the row should resolve itself: the worker either runs the
  // sweep (backend drops the slot) or bounces it back with no surplus (the
  // fresh-balance surplus cap hides it). Both land outside the "Executing…"
  // status, so we poll while a sweep is DUE (its window has passed) rather than
  // only while executing — otherwise polling stops at the revert and the stale
  // row lingers until a manual pull. `refreshAutodeposit` also force-refreshes
  // the wallet balance, so each tick re-evaluates the cap. Bounded so a
  // backend-stuck slot can't poll forever; a manual pull still works after that.
  const hasDueScheduledSweep = earnScheduledSweeps.some(isScheduledSweepDue);
  useEffect(() => {
    if (!hasDueScheduledSweep) {
      return;
    }
    let polls = 0;
    const intervalId = setInterval(() => {
      void refreshAutodeposit();
      polls += 1;
      if (polls >= MAX_DUE_SWEEP_POLLS) {
        clearInterval(intervalId);
      }
    }, DUE_SWEEP_POLL_MS);
    return () => clearInterval(intervalId);
  }, [hasDueScheduledSweep, refreshAutodeposit]);

  // After an Autodeposit create schedules a bootstrap sweep, the Earn tab
  // routes here before this provider's own Autodeposit read has caught up.
  // The expectation flag keeps a skeleton "Scheduled" row on screen until the
  // real sweep lands; the timeout gives up so a backend hiccup (or a sweep the
  // surplus cap hides because it already executed) can't pin a skeleton forever.
  const EXPECTED_SWEEP_TIMEOUT_MS = 30_000;
  const [expectingScheduledSweep, setExpectingScheduledSweep] = useState(false);
  const expectScheduledSweep = useCallback(
    () => setExpectingScheduledSweep(true),
    []
  );
  const hasVisibleScheduledSweep = earnScheduledSweeps.length > 0;
  useEffect(() => {
    if (!expectingScheduledSweep) {
      return;
    }
    if (hasVisibleScheduledSweep) {
      setExpectingScheduledSweep(false);
      return;
    }
    const timeoutId = setTimeout(
      () => setExpectingScheduledSweep(false),
      EXPECTED_SWEEP_TIMEOUT_MS
    );
    return () => clearTimeout(timeoutId);
  }, [expectingScheduledSweep, hasVisibleScheduledSweep]);

  const [isExecutingSweep, setIsExecutingSweep] = useState(false);
  // The in-place morph of an executed scheduled sweep into its result tx. Set
  // when "Execute now" succeeds; resolved (cross-faded) when the worker's
  // `balance_sweep` tx lands; cleared on blur / wallet change / safety timeout.
  const [sweepMorph, setSweepMorph] = useState<SweepMorph | null>(null);
  // The execute-now lifecycle flow stays open until the worker's result tx is
  // observed — completing it then makes elapsedMs the true request→done time.
  // Every abandonment path terminalizes both telemetry records before clearing.
  const pendingSweepFlowRef =
    useRef<LifecycleFlow<"earn.autodeposit.execute_now"> | null>(null);
  const pendingSweepMetricRef = useRef<ReturnType<
    typeof startMobileLoadingMetric
  > | null>(null);
  const sweepAttemptIdRef = useRef(0);
  const failPendingSweep = useCallback(() => {
    sweepAttemptIdRef.current += 1;
    pendingSweepFlowRef.current?.fail("ui_commit", {
      executeNowState: "failed",
    });
    pendingSweepFlowRef.current = null;
    pendingSweepMetricRef.current?.failAfterPaint();
    pendingSweepMetricRef.current = null;
  }, []);
  const clearSweepMorph = useCallback(() => {
    failPendingSweep();
    setSweepMorph(null);
  }, [failPendingSweep]);

  // Trigger the pending sweep now. The endpoint only advances the sweep's
  // eligibility (the worker still runs it), so we refresh the autodeposit state
  // — the row flips to "Executing…" — and the earn feed, where the result lands
  // as a `balance_sweep` tx. Instead of navigating away, we start a morph: the
  // executing row stays put and cross-fades into that result tx once it appears.
  const executeScheduledSweep = useCallback(async () => {
    if (!signer || !isWalletUnlocked(state) || isExecutingSweep) {
      return;
    }
    // Snapshot the targeted sweeps and the balance_sweep txs that already exist,
    // both captured before the round-trip: the snapshot keeps the executing row
    // rendered after the slot drops out, and the baseline lets us recognise the
    // worker's new result tx.
    const sweeps = earnScheduledSweeps;
    const baselineTxIds = new Set(
      earnTransactions.filter(isBalanceSweepTx).map((tx) => tx.id)
    );
    // A second accepted request must never overwrite an unterminated attempt.
    failPendingSweep();
    const attemptId = ++sweepAttemptIdRef.current;
    pendingSweepMetricRef.current = startMobileLoadingMetric(
      "earn.autodeposit.execute_now"
    );
    setIsExecutingSweep(true);
    try {
      const execution = await executeEarnAutodepositScheduledSweep({
        signer,
        flowId: pendingSweepMetricRef.current.flowId,
      });
      if (attemptId !== sweepAttemptIdRef.current) {
        execution.flow.fail("ui_commit", { executeNowState: "failed" });
        return;
      }
      pendingSweepFlowRef.current = execution.flow;
      if (sweeps.length > 0) {
        setSweepMorph({
          sweeps,
          scheduledSlotId: execution.scheduledSlotId,
          resultTx: null,
          baselineTxIds,
          startedAtMs: Date.now(),
        });
      }
      await Promise.all([refreshAutodeposit(), refreshEarnTransactions()]);
    } catch (error) {
      failPendingSweep();
      console.warn("[autodeposit] execute scheduled sweep failed", error);
      // The endpoint refuses with a user-actionable reason when the sweep can
      // never run as-is (e.g. no active Earn position after a full withdrawal)
      // — surface that instead of the generic retry copy, which would send the
      // user into a retry loop that can't succeed.
      const refusal =
        error instanceof EarnApiError &&
        (error.code === "earn_position_required" ||
          error.code === "autodeposit_not_active" ||
          error.code === "no_scheduled_sweeps")
          ? error.message
          : null;
      Alert.alert(
        refusal ? "Deposit can't run" : "Deposit didn't complete",
        refusal ??
          "The deposit didn't complete this time. Please wait 1 minute and try again."
      );
    } finally {
      setIsExecutingSweep(false);
    }
  }, [
    signer,
    state,
    isExecutingSweep,
    earnScheduledSweeps,
    earnTransactions,
    refreshAutodeposit,
    refreshEarnTransactions,
    failPendingSweep,
  ]);

  // Watch the Earn feed for the worker's result tx: the newest `balance_sweep`
  // that wasn't there when we executed. Once seen, attach it to the morph so the
  // UI cross-fades the executing row into it.
  useEffect(() => {
    if (!sweepMorph || sweepMorph.resultTx) {
      return;
    }
    const fresh = earnTransactions.find(
      (tx) => isBalanceSweepTx(tx) && !sweepMorph.baselineTxIds.has(tx.id)
    );
    if (fresh) {
      setSweepMorph((m) => (m && !m.resultTx ? { ...m, resultTx: fresh } : m));
      pendingSweepFlowRef.current?.complete("state_observed", {
        executeNowState: "completed",
      });
      pendingSweepFlowRef.current = null;
      pendingSweepMetricRef.current?.completeAfterPaint();
      pendingSweepMetricRef.current = null;
      // The sweep landing is what completes quest 2, and the worker reports it
      // within seconds — check now, and once more in case the report is still
      // in flight (deliberately no cleanup: a late one-shot nudge is harmless,
      // while clearing on this effect's frequent re-runs would cancel it).
      nudgeQuestProgressCheck();
      setTimeout(nudgeQuestProgressCheck, 8_000);
    }
  }, [earnTransactions, sweepMorph]);

  // While the morph is unresolved, poll the Earn feed so the result tx is picked
  // up without waiting for the 15s background tick. Bounded. Deliberately only
  // the feed (a backend read) — NOT `refreshAutodeposit`, which force-refreshes
  // token holdings over the Solana RPC: the morph resolves purely off the feed,
  // and adding holdings reads here (on top of the due-sweep poll) was pressuring
  // the rate-limited RPC into 429s.
  useEffect(() => {
    if (!sweepMorph || sweepMorph.resultTx) {
      return;
    }
    let polls = 0;
    const intervalId = setInterval(() => {
      void refreshEarnTransactions();
      polls += 1;
      if (polls >= MAX_SWEEP_RESULT_POLLS) {
        clearInterval(intervalId);
      }
    }, SWEEP_RESULT_POLL_MS);
    return () => clearInterval(intervalId);
  }, [sweepMorph, refreshEarnTransactions]);

  // Safety net: never pin a morph forever (it holds its result tx out of the
  // normal date groups). The Activity screen also clears it on blur.
  useEffect(() => {
    if (!sweepMorph) {
      return;
    }
    const timeoutId = setTimeout(() => {
      failPendingSweep();
      setSweepMorph(null);
    }, SWEEP_MORPH_MAX_MS);
    return () => clearTimeout(timeoutId);
  }, [sweepMorph, failPendingSweep]);

  // A morph/expectation belongs to one wallet — drop them if the wallet changes.
  useEffect(() => {
    failPendingSweep();
    setSweepMorph(null);
    setExpectingScheduledSweep(false);
  }, [publicKey, failPendingSweep]);

  // Which scheduled slot to watch on the granular progress endpoint: the
  // unresolved morph's snapshotted sweep (the slot drops out of the live
  // pending list right after an execute), else the first due sweep. `id` IS
  // the scheduled slot id since the slot-aggregation rework.
  const [sweepProgressState, setSweepProgressState] =
    useState<EarnAutodepositSweepProgressState | null>(null);
  const dueSweepSlotId =
    earnScheduledSweeps.find(isScheduledSweepDue)?.id ?? null;
  const watchedSweepSlotId = sweepMorph
    ? sweepMorph.resultTx
      ? null
      : sweepMorph.scheduledSlotId
    : dueSweepSlotId;

  // Burst-poll the watched sweep's granular progress. Cheap (single-row read,
  // no RPC), so it ticks at 1s under the coarse loops above; the moment the
  // flight ends (worker done, or the slot bounced back to "scheduled" with no
  // surplus) it fires ONE immediate coarse refresh instead of letting the row
  // wait out the next 2–2.5s tick. Misses (backend without the endpoint, no
  // matching slot) stop the poll quietly — the coarse loops remain the
  // fallback and behave exactly as before.
  useEffect(() => {
    if (!publicKey || !watchedSweepSlotId) {
      setSweepProgressState(null);
      return;
    }
    let cancelled = false;
    let fetching = false;
    let sawInFlight = false;
    let polls = 0;
    let misses = 0;
    const intervalId = setInterval(() => {
      if (fetching) {
        return;
      }
      polls += 1;
      if (polls > MAX_SWEEP_PROGRESS_POLLS) {
        clearInterval(intervalId);
        return;
      }
      fetching = true;
      void fetchEarnAutodepositSweepProgress(publicKey, watchedSweepSlotId)
        .then((progress) => {
          if (cancelled) {
            return;
          }
          if (!progress) {
            misses += 1;
            if (misses >= MAX_SWEEP_PROGRESS_MISSES) {
              clearInterval(intervalId);
            }
            return;
          }
          misses = 0;
          setSweepProgressState(progress.state);
          const bouncedBack = sawInFlight && progress.state === "scheduled";
          if (progress.state !== "scheduled") {
            sawInFlight = true;
          }
          if (
            progress.state === "failed" ||
            progress.state === "released" ||
            progress.state === "canceled"
          ) {
            if (progress.state === "canceled") {
              pendingSweepFlowRef.current?.cancel("state_observed", {
                executeNowState: progress.state,
              });
            } else {
              pendingSweepFlowRef.current?.fail("state_observed", {
                executeNowState: progress.state,
              });
            }
            pendingSweepFlowRef.current = null;
            pendingSweepMetricRef.current?.failAfterPaint();
            pendingSweepMetricRef.current = null;
            setSweepMorph(null);
          }
          if (SWEEP_PROGRESS_END_STATES.has(progress.state) || bouncedBack) {
            clearInterval(intervalId);
            void refreshAutodeposit();
            void refreshEarnTransactions();
          }
        })
        .finally(() => {
          fetching = false;
        });
    }, SWEEP_PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [
    publicKey,
    watchedSweepSlotId,
    refreshAutodeposit,
    refreshEarnTransactions,
  ]);

  const [earnRefunds, setEarnRefunds] = useState<EarnRefundItem[]>([]);
  const [earnLockedRefundLamports, setEarnLockedRefundLamports] = useState(0);
  const [refundingAccount, setRefundingAccount] = useState<string | null>(null);

  // Scan for refundable closed Earn accounts. Read-only — never prompts Seed
  // Vault. Resolves to the fresh list so callers can route the user to the
  // Earn feed when refunds exist.
  const refreshEarnRefunds = useCallback(async (): Promise<
    EarnRefundItem[]
  > => {
    if (!publicKey) {
      setEarnRefunds([]);
      setEarnLockedRefundLamports(0);
      return [];
    }
    try {
      const { scan } = await scanEarnRefunds(publicKey);
      const items: EarnRefundItem[] = [
        ...(scan?.policies ?? [])
          .filter((policy) => policy.canRefund && (policy.lamports ?? 0) > 0)
          .map((policy) => ({
            kind: "policy" as const,
            account: policy.account,
            lamports: policy.lamports ?? 0,
          })),
        ...(scan?.recurringDelegations ?? [])
          .filter(
            (delegation) =>
              delegation.canRefund && (delegation.lamports ?? 0) > 0
          )
          .map((delegation) => ({
            kind: "recurring_delegation" as const,
            account: delegation.account,
            lamports: delegation.lamports ?? 0,
          })),
        ...(scan?.vault?.canRefund && scan.vault.totalRefundableLamports > 0
          ? [
              {
                kind: "vault" as const,
                account: scan.vault.account,
                lamports: scan.vault.totalRefundableLamports,
              },
            ]
          : []),
      ];
      // Rents held hostage by the Autodeposit (blocked reasons like "Active
      // Autodeposit" / "Paused Autodeposit delegation" / "Protected recurring
      // delegation") — refundable the moment the Autodeposit is deleted.
      // Position-blocked buckets ("Active Earn position") are working capital,
      // not stranded rent, so they don't count.
      const isAutodepositBlock = (reason: string | null | undefined) =>
        typeof reason === "string" &&
        /autodeposit|recurring delegation/i.test(reason);
      const lockedLamports =
        (scan?.policies ?? [])
          .filter((p) => !p.canRefund && isAutodepositBlock(p.blockedReason))
          .reduce((sum, p) => sum + (p.lamports ?? 0), 0) +
        (scan?.recurringDelegations ?? [])
          .filter((d) => !d.canRefund && isAutodepositBlock(d.blockedReason))
          .reduce((sum, d) => sum + (d.lamports ?? 0), 0) +
        (scan?.vault &&
        !scan.vault.canRefund &&
        isAutodepositBlock(scan.vault.blockedReason)
          ? scan.vault.totalRefundableLamports
          : 0);
      setEarnRefunds(items);
      setEarnLockedRefundLamports(lockedLamports);
      return items;
    } catch (error) {
      console.warn("[earn-refunds] scan failed", error);
      return [];
    }
  }, [publicKey]);

  // Auto-scan on start / wallet change.
  useEffect(() => {
    void refreshEarnRefunds();
  }, [refreshEarnRefunds]);

  const executeRefund = useCallback(
    async (item: EarnRefundItem) => {
      if (!signer || !isWalletUnlocked(state) || refundingAccount) {
        return;
      }
      setRefundingAccount(item.account);
      const metric = startMobileLoadingMetric("earn.refund");
      try {
        const request: EarnRefundPrepareRequest =
          item.kind === "policy"
            ? { kind: "policy", policyAccount: item.account }
            : item.kind === "recurring_delegation"
            ? {
                kind: "recurring_delegation",
                recurringDelegation: item.account,
              }
            : { kind: "vault" };
        await executeEarnRefund({ signer, request });
        // Drop the row right away, then rescan for anything remaining. The
        // refunded SOL shows up in the wallet balance, not the Earn feed.
        setEarnRefunds((current) =>
          current.filter((refund) => refund.account !== item.account)
        );
        void refreshEarnRefunds();
        metric.completeAfterPaint();
      } catch (error) {
        metric.failAfterPaint();
        // Row stays for a retry; the device re-scans chain state on every prepare.
        console.warn("[earn-refunds] refund failed", error);
        Alert.alert(
          "Refund didn't complete",
          "Refund didn't complete this time. Please wait 1 minute and try again."
        );
      } finally {
        setRefundingAccount(null);
      }
    },
    [signer, state, refundingAccount, refreshEarnRefunds]
  );

  // Escape hatch for the locked-rent row: the Earn tab's Delete control only
  // renders once a deposit exists, so a wallet whose position is closed — the
  // very state that strands this rent — can't reach it. This runs the same
  // on-device close (the close tx itself returns the rent). Offered only for a
  // paused Autodeposit; a running one is managed from the Earn tab.
  const canDeleteLockedRefundAutodeposit =
    autodeposit != null &&
    !autodeposit.active &&
    autodeposit.status !== "pending" &&
    autodeposit.recurringDelegation != null;
  const [deletingAutodeposit, setDeletingAutodeposit] = useState(false);

  const deleteAutodepositForRefund = useCallback(() => {
    if (
      !canDeleteLockedRefundAutodeposit ||
      !autodeposit?.recurringDelegation ||
      !signer ||
      !isWalletUnlocked(state) ||
      deletingAutodeposit
    ) {
      return;
    }
    const { policyAccount, recurringDelegation } = autodeposit;
    Alert.alert(
      "Delete Autodeposit?",
      "This removes Autodeposit and returns its reserved SOL to your wallet.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeletingAutodeposit(true);
            void (async () => {
              try {
                const confirmedClose = await executeEarnAutodepositClose({
                  signer,
                  policy: policyAccount,
                  recurringDelegation,
                });
                confirmAutodepositClose(confirmedClose);
                // The close tx already refunded the rent — clear the row now,
                // then rescan (the chain read can lag a beat behind).
                setEarnLockedRefundLamports(0);
                void refreshAutodepositState();
                void refreshEarnRefunds();
              } catch (error) {
                console.warn("[earn-refunds] autodeposit delete failed", error);
                Alert.alert(
                  "Delete didn't complete",
                  "Autodeposit wasn't deleted this time. Please wait 1 minute and try again."
                );
              } finally {
                setDeletingAutodeposit(false);
              }
            })();
          },
        },
      ]
    );
  }, [
    canDeleteLockedRefundAutodeposit,
    autodeposit,
    signer,
    state,
    deletingAutodeposit,
    confirmAutodepositClose,
    refreshAutodepositState,
    refreshEarnRefunds,
  ]);

  const newestWalletTs = useMemo(() => {
    let newest = 0;
    for (const tx of walletTransactions) {
      if (tx.timestamp > newest) newest = tx.timestamp;
    }
    return newest;
  }, [walletTransactions]);

  const newestEarnTs = useMemo(() => {
    let newest = 0;
    for (const tx of earnTransactions) {
      const ts = earnTransactionTimestampMs(tx);
      if (ts > newest) newest = ts;
    }
    return newest;
  }, [earnTransactions]);

  const [seenWallet, setSeenWallet] = useState<number | undefined>(() =>
    getActivityLastSeen("wallet")
  );
  const [seenEarn, setSeenEarn] = useState<number | undefined>(() =>
    getActivityLastSeen("earn")
  );

  // First ever launch: seed last-seen to the newest known item so the user's
  // pre-existing history doesn't light up the dot. Only new items afterwards do.
  useEffect(() => {
    if (newestWalletTs <= 0 || seenWallet !== undefined) return;
    setActivityLastSeen("wallet", newestWalletTs);
    setSeenWallet(newestWalletTs);
  }, [newestWalletTs, seenWallet]);

  useEffect(() => {
    if (newestEarnTs <= 0 || seenEarn !== undefined) return;
    setActivityLastSeen("earn", newestEarnTs);
    setSeenEarn(newestEarnTs);
  }, [newestEarnTs, seenEarn]);

  const markSeen = useCallback(
    (section: ActivitySection) => {
      // Skip until items have loaded — recording a 0 baseline would make every
      // real transaction that arrives afterwards look "new".
      if (section === "wallet" && newestWalletTs > 0) {
        setActivityLastSeen("wallet", newestWalletTs);
        setSeenWallet(newestWalletTs);
      }
      if (section === "earn" && newestEarnTs > 0) {
        setActivityLastSeen("earn", newestEarnTs);
        setSeenEarn(newestEarnTs);
      }
    },
    [newestWalletTs, newestEarnTs]
  );

  const walletUnread = seenWallet !== undefined && newestWalletTs > seenWallet;
  const earnUnread = seenEarn !== undefined && newestEarnTs > seenEarn;

  const value = useMemo<ActivityContextValue>(
    () => ({
      walletAddress: publicKey,
      walletTransactions,
      isFetchingTransactions,
      loadWalletTransactions,
      earnTransactions,
      isFetchingEarn,
      hasLoadedEarn,
      refreshEarnTransactions,
      refreshAutodeposit,
      earnScheduledSweeps,
      isExecutingSweep,
      executeScheduledSweep,
      autodepositPausedMissingPosition,
      expectingScheduledSweep,
      expectScheduledSweep,
      sweepMorph,
      clearSweepMorph,
      sweepProgressState,
      walletUnread,
      earnUnread,
      anyUnread: walletUnread || earnUnread,
      markSeen,
      earnRefunds,
      earnLockedRefundLamports,
      refreshEarnRefunds,
      refundingAccount,
      executeRefund,
      canDeleteLockedRefundAutodeposit,
      deletingAutodeposit,
      deleteAutodepositForRefund,
    }),
    [
      publicKey,
      walletTransactions,
      isFetchingTransactions,
      loadWalletTransactions,
      earnTransactions,
      isFetchingEarn,
      hasLoadedEarn,
      refreshEarnTransactions,
      refreshAutodeposit,
      earnScheduledSweeps,
      isExecutingSweep,
      executeScheduledSweep,
      autodepositPausedMissingPosition,
      expectingScheduledSweep,
      expectScheduledSweep,
      sweepMorph,
      clearSweepMorph,
      sweepProgressState,
      walletUnread,
      earnUnread,
      markSeen,
      earnRefunds,
      earnLockedRefundLamports,
      refreshEarnRefunds,
      refundingAccount,
      executeRefund,
      canDeleteLockedRefundAutodeposit,
      deletingAutodeposit,
      deleteAutodepositForRefund,
    ]
  );

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) {
    throw new Error("useActivity must be used within an ActivityProvider");
  }
  return ctx;
}
