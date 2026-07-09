import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { executeEarnAutodepositScheduledSweep } from "@/lib/solana/earn/autodeposit";
import {
  fetchEarnRefundScan,
  type EarnAutodepositScheduledSweep,
  type EarnRefundPrepareRequest,
  type EarnTransactionItem,
} from "@/lib/solana/earn/earn-api";
import { executeEarnRefund } from "@/lib/solana/earn/refund";
import {
  EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW,
  getVisibleEarnScheduledSweeps,
  isScheduledSweepDue,
} from "@/lib/solana/earn/earn-scheduled-sweep";
import { earnTransactionTimestampMs } from "@/lib/solana/earn/earn-tx-display";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
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
  /** True while an "Execute now" request is in flight. */
  isExecutingSweep: boolean;
  /** Ask the worker to run the pending scheduled sweep now. */
  executeScheduledSweep: () => Promise<void>;
  /**
   * An executed scheduled sweep morphing in place into its result `balance_sweep`
   * tx (or null when none is in progress). Drives the cross-fade in the Earn feed.
   */
  sweepMorph: SweepMorph | null;
  /** Drop the in-place sweep morph (called when the Activity screen blurs). */
  clearSweepMorph: () => void;
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
  /** Rescan for refundable accounts; resolves to the fresh list. */
  refreshEarnRefunds: () => Promise<EarnRefundItem[]>;
  /** Account whose refund is currently in flight, or null. */
  refundingAccount: string | null;
  /** Prepare, sign and send one refund, then rescan. */
  executeRefund: (item: EarnRefundItem) => Promise<void>;
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
  const { autodeposit, refreshAutodeposit: refreshAutodepositState } =
    useEarnAutodeposit(publicKey);

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
        BigInt(sweep.remainingAmountRaw) >= EARN_SCHEDULED_SWEEP_MIN_VISIBLE_RAW,
    );
  const { tokenHoldings, refreshTokenHoldings } = useTokenHoldings(
    hasScheduledSweepCandidate ? publicKey : null,
  );
  const walletUsdcRaw = useMemo<bigint | null>(() => {
    const holding = tokenHoldings.find(
      (h) =>
        h.mint === SOLANA_USDC_MINT_MAINNET ||
        h.mint === SOLANA_USDC_MINT_DEVNET,
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
        scheduledSweepFloorRaw,
      ),
    [autodeposit, walletUsdcRaw, scheduledSweepFloorRaw],
  );

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

  const [isExecutingSweep, setIsExecutingSweep] = useState(false);
  // The in-place morph of an executed scheduled sweep into its result tx. Set
  // when "Execute now" succeeds; resolved (cross-faded) when the worker's
  // `balance_sweep` tx lands; cleared on blur / wallet change / safety timeout.
  const [sweepMorph, setSweepMorph] = useState<SweepMorph | null>(null);
  const clearSweepMorph = useCallback(() => setSweepMorph(null), []);

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
      earnTransactions.filter(isBalanceSweepTx).map((tx) => tx.id),
    );
    setIsExecutingSweep(true);
    try {
      await executeEarnAutodepositScheduledSweep({ signer });
      if (sweeps.length > 0) {
        setSweepMorph({
          sweeps,
          resultTx: null,
          baselineTxIds,
          startedAtMs: Date.now(),
        });
      }
      await Promise.all([refreshAutodeposit(), refreshEarnTransactions()]);
    } catch (error) {
      console.warn("[autodeposit] execute scheduled sweep failed", error);
      Alert.alert(
        "Deposit didn't complete",
        "The deposit didn't complete this time. Please wait 1 minute and try again.",
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
  ]);

  // Watch the Earn feed for the worker's result tx: the newest `balance_sweep`
  // that wasn't there when we executed. Once seen, attach it to the morph so the
  // UI cross-fades the executing row into it.
  useEffect(() => {
    if (!sweepMorph || sweepMorph.resultTx) {
      return;
    }
    const fresh = earnTransactions.find(
      (tx) => isBalanceSweepTx(tx) && !sweepMorph.baselineTxIds.has(tx.id),
    );
    if (fresh) {
      setSweepMorph((m) => (m && !m.resultTx ? { ...m, resultTx: fresh } : m));
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
    const timeoutId = setTimeout(
      () => setSweepMorph(null),
      SWEEP_MORPH_MAX_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [sweepMorph]);

  // A morph belongs to one wallet's execution — drop it if the wallet changes.
  useEffect(() => {
    setSweepMorph(null);
  }, [publicKey]);

  const [earnRefunds, setEarnRefunds] = useState<EarnRefundItem[]>([]);
  const [refundingAccount, setRefundingAccount] = useState<string | null>(null);

  // Scan for refundable closed Earn accounts. Read-only — never prompts Seed
  // Vault. Resolves to the fresh list so callers can route the user to the
  // Earn feed when refunds exist.
  const refreshEarnRefunds = useCallback(async (): Promise<EarnRefundItem[]> => {
    if (!publicKey) {
      setEarnRefunds([]);
      return [];
    }
    try {
      const { scan } = await fetchEarnRefundScan(publicKey);
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
              delegation.canRefund && (delegation.lamports ?? 0) > 0,
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
      setEarnRefunds(items);
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
      try {
        const request: EarnRefundPrepareRequest =
          item.kind === "policy"
            ? { kind: "policy", policyAccount: item.account }
            : item.kind === "recurring_delegation"
              ? { kind: "recurring_delegation", recurringDelegation: item.account }
              : { kind: "vault" };
        await executeEarnRefund({ signer, request });
        // Drop the row right away, then rescan for anything remaining. The
        // refunded SOL shows up in the wallet balance, not the Earn feed.
        setEarnRefunds((current) =>
          current.filter((refund) => refund.account !== item.account),
        );
        void refreshEarnRefunds();
      } catch (error) {
        // Row stays for a retry; the backend re-verifies on every prepare.
        console.warn("[earn-refunds] refund failed", error);
        Alert.alert(
          "Refund didn't complete",
          "Refund didn't complete this time. Please wait 1 minute and try again.",
        );
      } finally {
        setRefundingAccount(null);
      }
    },
    [signer, state, refundingAccount, refreshEarnRefunds],
  );

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
    getActivityLastSeen("wallet"),
  );
  const [seenEarn, setSeenEarn] = useState<number | undefined>(() =>
    getActivityLastSeen("earn"),
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
    [newestWalletTs, newestEarnTs],
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
      sweepMorph,
      clearSweepMorph,
      walletUnread,
      earnUnread,
      anyUnread: walletUnread || earnUnread,
      markSeen,
      earnRefunds,
      refreshEarnRefunds,
      refundingAccount,
      executeRefund,
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
      sweepMorph,
      clearSweepMorph,
      walletUnread,
      earnUnread,
      markSeen,
      earnRefunds,
      refreshEarnRefunds,
      refundingAccount,
      executeRefund,
    ],
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
