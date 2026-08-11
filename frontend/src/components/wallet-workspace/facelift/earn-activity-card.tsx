"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { EarnYieldIcon } from "@/components/wallet-sidebar/portfolio-content";
import { readCssDurationMs } from "@/components/wallet-workspace/facelift/css-duration";
import { getWithdrawSourceKeyForHolding } from "@/components/wallet-workspace/facelift/earn-actions-support";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import {
  StaggerLine,
  StaggerReveal,
} from "@/components/wallet-workspace/facelift/stagger-reveal";
import {
  formatEarnTransactionTimestamp,
  formatScheduledSweepAmount,
  formatScheduledSweepTime,
  getEarnTransactionAmountColor,
  getEarnTransactionRowLabel,
  groupEarnTransactions,
  resolveEarnTransactionDisplayTimeZone,
  shouldShowScheduledSweepsSection,
} from "@/components/wallet-workspace/earn-transactions-pane";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import type { ActiveEarnPositionHolding } from "@/hooks/use-active-earn-position";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import type { EarnAutodepositProgress } from "@/features/earn-realtime";
import {
  formatLoadedScheduledSweepAvailableIn,
  getLoadedScheduledSweepExecuteNowAvailableAtMs,
  rawTokenAmountToNumber,
  type LoadedEarnAutodepositScheduledSweep,
} from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import { resolveEarnTransactionMarketIcon } from "@/lib/yield-optimization/earn-position-display";
import {
  fetchEarnTransactions,
  type EarnTransactionItem,
} from "@/lib/yield-optimization/earn-transactions.client";

const ASSET_BASE = "/wallet-workspace/facelift";
const KAMINO_ICON = "/wallet-workspace/earn-kamino.png";
const TRANSACTIONS_LIMIT = 5;
const ACTIVITY_TABS = ["Transactions", "Positions"] as const;

type ActivityTab = (typeof ACTIVITY_TABS)[number];

export function UsdcCoinImage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="absolute inset-0 size-full"
        src="/wallet-workspace/earn-vault-usdc.png"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="absolute inset-0 size-full"
        src="/wallet-workspace/earn-vault-usdc-overlay.png"
      />
    </>
  );
}

// Same fallback rules as the old pane's CompoundIcon, at the redesign's 44px.
export function DualIcon({
  backSrc = null,
  frontSrc = null,
  isWithdraw = false,
}: {
  backSrc?: string | null;
  frontSrc?: string | null;
  isWithdraw?: boolean;
}) {
  const back = backSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="absolute inset-0 size-full" src={backSrc} />
  ) : isWithdraw ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="absolute inset-0 size-full" src={KAMINO_ICON} />
  ) : (
    <UsdcCoinImage />
  );
  const front = frontSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="absolute inset-0 size-full" src={frontSrc} />
  ) : isWithdraw ? (
    <UsdcCoinImage />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="absolute inset-0 size-full" src={KAMINO_ICON} />
  );

  return (
    <span className="relative block size-11 shrink-0">
      <span className="absolute top-0 left-0 block size-[30px] overflow-hidden rounded-full">
        {back}
      </span>
      <span className="absolute right-0 bottom-0 block size-[30px] overflow-hidden rounded-full">
        {front}
      </span>
    </span>
  );
}

function RouteLabel({
  destination,
  source,
}: {
  destination: string;
  source: string;
}) {
  return (
    <span className="flex items-center justify-end gap-1">
      <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
        {source}
      </span>
      <ThemedIcon
        className="size-4 text-tertiary"
        src={`${ASSET_BASE}/icon-arrow-right-circle.svg`}
      />
      <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
        {destination}
      </span>
    </span>
  );
}

export function GroupHeader({ label }: { label: string }) {
  return (
    <div className="flex w-full items-start px-4 pt-1">
      <p className="min-w-0 flex-1 pt-3 pb-2 text-[16px] leading-5 tracking-[-0.176px] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export type ExecuteNowControls = {
  error: string | null;
  isPending: boolean;
  progressBySlot: Readonly<Record<string, EarnAutodepositProgress>>;
  run: (sweep: LoadedEarnAutodepositScheduledSweep) => Promise<boolean>;
};

// earn-transactions-pane.tsx:726-780 — sweep button copy per execute-now
// progress state, and the persisted-retry check. Unlike the OG the subtitle
// keeps the schedule time — status shows ONLY in the button (user request).
function isPersistedScheduledSweepRetryable(
  sweep: LoadedEarnAutodepositScheduledSweep
): boolean {
  return sweep.status === "failed" || sweep.status === "released";
}

function getAutodepositProgressButtonLabel(
  progress: EarnAutodepositProgress | undefined
): string | null {
  switch (progress?.state) {
    case "requesting":
      return "Requesting...";
    case "requested":
      return "Queued";
    case "selected":
      return "Preparing...";
    case "pull_confirmed":
      return "Depositing...";
    case "completed":
      return "Complete";
    case "failed":
    case "released":
    case "canceled":
      return "Try again";
    default:
      return null;
  }
}

// OG behavior (earn-transactions-pane.tsx ScheduledTransactionRow) in the
// facelift row styling: countdown until execute-now unlocks, per-slot
// progress labels while the sweep runs, retry states after failure.
function ScheduledSweepRow({
  executeNow,
  nowMs,
  sweep,
}: {
  executeNow: ExecuteNowControls;
  nowMs: number;
  sweep: LoadedEarnAutodepositScheduledSweep;
}) {
  const amountLabel = formatScheduledSweepAmount(sweep.remainingAmountRaw);
  const { isBalanceHidden } = useBalanceVisibility();
  const progress = executeNow.progressBySlot[sweep.slotId ?? sweep.id];
  const progressButtonLabel = getAutodepositProgressButtonLabel(progress);
  const isProgressActive = Boolean(
    progress &&
      ["requesting", "requested", "selected", "pull_confirmed"].includes(
        progress.state
      )
  );
  const isProgressComplete = progress?.state === "completed";
  const isProgressRetryable = Boolean(
    progress && ["failed", "released", "canceled"].includes(progress.state)
  );
  const isRetryable = isPersistedScheduledSweepRetryable(sweep);
  const executeNowAvailableAtMs =
    getLoadedScheduledSweepExecuteNowAvailableAtMs(sweep);
  const availableInLabel =
    executeNowAvailableAtMs === null
      ? null
      : formatLoadedScheduledSweepAvailableIn(executeNowAvailableAtMs, nowMs);
  const isWaitingForDelegation = availableInLabel !== null;
  const isButtonDisabled =
    executeNow.isPending ||
    isProgressActive ||
    isProgressComplete ||
    isWaitingForDelegation;
  const buttonLabel =
    progressButtonLabel ??
    availableInLabel ??
    (executeNow.isPending
      ? "Requesting..."
      : isRetryable || isProgressRetryable
      ? "Try again"
      : "Execute now");

  return (
    <div className="flex w-full flex-col rounded-2xl">
      <div className="flex w-full items-start px-4">
        <div className="flex items-center py-2 pr-3">
          <DualIcon />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
            <p className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
              Autodeposit
            </p>
            <p className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
              {formatScheduledSweepTime(sweep.eligibleAfter)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 py-[11px] pl-3">
            <p className="whitespace-nowrap text-[16px] text-foreground leading-5 text-right">
              <ScrambleText isHidden={isBalanceHidden} text={amountLabel} />
            </p>
            <RouteLabel destination="Earn" source="Main" />
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col items-start px-4 pt-1 pb-2">
        <button
          aria-busy={isProgressActive}
          className="t-hover flex h-9 items-center justify-center rounded-full bg-accent px-4 font-medium text-[14px] text-foreground leading-5 enabled:hover:bg-accent-active disabled:opacity-50"
          disabled={isButtonDisabled}
          onClick={() => void executeNow.run(sweep)}
          type="button"
        >
          <TextSwap text={buttonLabel} />
        </button>
        {executeNow.error && !isProgressActive ? (
          <p className="pt-2 text-[13px] leading-4 text-destructive">
            {executeNow.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function TransactionRow({
  isSelected = false,
  item,
  onSelect,
}: {
  isSelected?: boolean;
  item: EarnTransactionItem;
  onSelect?: () => void;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const isMovement =
    item.kind === "rebalance" || item.kind === "reconciliation";
  const backSrc =
    isMovement || item.kind === "withdraw" ? item.source.icon : null;
  const frontSrc =
    isMovement || item.kind === "deposit" ? item.destination.icon : null;
  const timeLabel =
    formatEarnTransactionTimestamp(item.confirmedAt ?? item.sortTimestamp) ??
    item.timestamp;

  const content = (
    <>
      <span className="flex items-center py-2 pr-3">
        {item.kind === "autodeposit_action" ? (
          <span className="inline-flex size-11 shrink-0 overflow-hidden rounded-full">
            <EarnYieldIcon size={44} />
          </span>
        ) : (
          <DualIcon
            backSrc={backSrc}
            frontSrc={frontSrc}
            isWithdraw={item.kind === "withdraw"}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <span className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
          {getEarnTransactionRowLabel(item)}
        </span>
        <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
          {timeLabel}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5 py-[11px] pl-3">
        <span
          className="whitespace-nowrap text-[16px] leading-5 text-right"
          style={{
            color: getEarnTransactionAmountColor({ kind: item.kind }),
          }}
        >
          <ScrambleText isHidden={isBalanceHidden} text={item.amount} />
        </span>
        <RouteLabel
          destination={item.destination.label}
          source={item.source.label}
        />
      </span>
    </>
  );

  // Without a select handler (the Earn card's recent-5 list) the row stays a
  // plain, non-interactive cell; the Activity feed passes one to open the
  // transaction detail.
  if (!onSelect) {
    return (
      <div className="flex w-full items-center rounded-2xl px-4">{content}</div>
    );
  }
  return (
    <button
      className={`flex w-full items-center rounded-2xl px-4 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 ${
        isSelected ? "bg-accent" : "hover:bg-accent"
      }`}
      onClick={onSelect}
      type="button"
    >
      {content}
    </button>
  );
}

// A row arriving after the initial load (a just-confirmed mutation) pushes
// the list down and reveals: the slot grows 0fr → 1fr on the resize clock
// (accordion mechanics, frontend/transitions/accordion.md) while the row
// replays the texts-reveal rise. Mounted closed + pre-reveal, flipped after
// a forced reflow.
function NewRowReveal({ children }: { children: ReactNode }) {
  const growRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grow = growRef.current;
    const line = lineRef.current;
    if (!(grow && line)) {
      return;
    }
    void grow.offsetHeight;
    grow.classList.add("is-open");
    line.classList.remove("is-entering");
  }, []);

  return (
    <div className="t-row-grow" ref={growRef}>
      <div>
        <div className="t-stagger-line is-entering" ref={lineRef}>
          {children}
        </div>
      </div>
    </div>
  );
}

function TransactionsTab({
  executeNow,
  onSelectTransaction,
  onViewAllActivity,
  pendingSignatures,
  refreshKey,
  scheduledSweeps,
  selectedTransactionId,
  settingsPda,
  walletAddress,
}: {
  executeNow: ExecuteNowControls;
  onSelectTransaction: (item: EarnTransactionItem) => void;
  onViewAllActivity: () => void;
  pendingSignatures: string[];
  refreshKey: number;
  scheduledSweeps: LoadedEarnAutodepositScheduledSweep[];
  selectedTransactionId: string | null;
  settingsPda: string | null | undefined;
  walletAddress: string | null;
}) {
  const publicEnv = usePublicEnv();
  const { isAuthenticated, isHydrated } = useAuthSession();
  const [items, setItems] = useState<EarnTransactionItem[] | null>(null);
  const [hasError, setHasError] = useState(false);

  // Countdown clock for execute-now availability (earn-transactions-pane.tsx:
  // 1654-1698): ticks every second only while a sweep is still locked.
  const [scheduledSweepNowMs, setScheduledSweepNowMs] = useState(() =>
    Date.now()
  );
  useEffect(() => {
    const hasFutureExecuteNow = scheduledSweeps.some((sweep) => {
      const availableAtMs =
        getLoadedScheduledSweepExecuteNowAvailableAtMs(sweep);
      return availableAtMs !== null && availableAtMs > Date.now();
    });
    if (!hasFutureExecuteNow) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setScheduledSweepNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [scheduledSweeps]);

  useEffect(() => {
    if (!(isAuthenticated && isHydrated && settingsPda && walletAddress)) {
      return;
    }
    let isCurrent = true;
    fetchEarnTransactions({
      settingsPda,
      solanaEnv: publicEnv.solanaEnv,
      walletAddress,
    })
      .then((response) => {
        if (isCurrent) {
          setItems(response.transactions);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setHasError(true);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [
    isAuthenticated,
    isHydrated,
    publicEnv.solanaEnv,
    // Bumped by the realtime stack after a confirmed Earn mutation so the
    // list refetches (the client cache was invalidated just before).
    refreshKey,
    settingsPda,
    walletAddress,
  ]);

  const groups = useMemo(
    () =>
      groupEarnTransactions(
        (items ?? []).slice(0, TRANSACTIONS_LIMIT),
        resolveEarnTransactionDisplayTimeZone()
      ),
    [items]
  );

  // Just-confirmed mutations the indexed list hasn't caught up with yet
  // (~5s): each shows a skeleton row at the top until its signature lands in
  // a refetch. Only counted once the list is loaded — the initial-load
  // skeleton below already covers items === null.
  const pendingRows =
    items === null
      ? []
      : pendingSignatures.filter(
          (signature) => !items.some((item) => item.signature === signature)
        );

  // Wrapper choice per row must stay stable across re-renders, so each key's
  // reveal kind is decided once, when it first appears: rows in the first
  // loaded batch ride the group's mount stagger; rows appearing on later
  // refetches grow into the list via NewRowReveal instead.
  const hasRenderedRowsRef = useRef(false);
  const revealKindsRef = useRef(new Map<string, "insert" | "stagger">());
  useEffect(() => {
    if (groups.length > 0) {
      hasRenderedRowsRef.current = true;
    }
  }, [groups]);
  const resolveRevealKind = (key: string): "insert" | "stagger" => {
    const kinds = revealKindsRef.current;
    const existing = kinds.get(key);
    if (existing) {
      return existing;
    }
    const kind = hasRenderedRowsRef.current ? "insert" : "stagger";
    kinds.set(key, kind);
    return kind;
  };

  return (
    <div className="flex w-full flex-col px-2 pb-2">
      {shouldShowScheduledSweepsSection(scheduledSweeps) ? (
        <StaggerReveal className="flex w-full flex-col">
          <StaggerLine index={0}>
            <div className="flex w-full items-start px-4 pt-1">
              <div className="flex min-w-0 flex-1 items-center gap-1 pt-3 pb-2">
                <ThemedIcon
                  className="size-5 text-tertiary"
                  src={`${ASSET_BASE}/icon-clock.svg`}
                />
                <p className="min-w-0 flex-1 text-[16px] leading-5 tracking-[-0.176px] text-muted-foreground">
                  Scheduled
                </p>
              </div>
            </div>
          </StaggerLine>
          {scheduledSweeps.map((sweep, index) => (
            <StaggerLine index={index + 1} key={sweep.id}>
              <ScheduledSweepRow
                executeNow={executeNow}
                nowMs={scheduledSweepNowMs}
                sweep={sweep}
              />
            </StaggerLine>
          ))}
        </StaggerReveal>
      ) : null}

      {items === null && !hasError ? (
        // transitions.dev skeleton pulse (t-skel-rows rides the recipe's
        // pulse clock); the loaded rows below reveal with the texts stagger.
        <div className="t-skel-rows flex flex-col gap-2 px-4 py-3">
          {[0, 1, 2].map((index) => (
            <div
              className="h-[60px] w-full rounded-2xl bg-accent"
              key={index}
            />
          ))}
        </div>
      ) : null}
      {pendingRows.length > 0 ? (
        // A just-confirmed deposit/withdrawal not yet in the indexed list:
        // hold its slot at the top with a pulsing row until the refetch
        // brings the real one (which then grows in via NewRowReveal).
        // Plain direct children of t-skel-rows — the pulse targets them, and
        // t-stagger-line must not be used here (it stays opacity:0 outside a
        // StaggerReveal parent).
        <div className="t-skel-rows flex flex-col gap-2 px-4 py-3">
          {pendingRows.map((signature) => (
            <div
              className="h-[60px] w-full rounded-2xl bg-accent"
              key={signature}
            />
          ))}
        </div>
      ) : null}
      {hasError ? (
        <p className="px-4 py-3 text-[13px] leading-4 text-muted-foreground">
          Failed to load transactions.
        </p>
      ) : null}
      {items !== null && items.length === 0 && pendingRows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] leading-4 text-muted-foreground">
          No transactions yet.
        </p>
      ) : null}

      {items !== null && groups.length > 0 ? (
        // Mounts only once the fetch lands, so the stagger plays right as the
        // skeleton rows leave.
        <StaggerReveal className="flex w-full flex-col">
          {(() => {
            let lineIndex = 0;
            const renderedGroups = groups.map((group) => (
              <div className="flex w-full flex-col" key={group.date}>
                {resolveRevealKind(`h:${group.date}`) === "insert" ? (
                  <NewRowReveal>
                    <GroupHeader label={group.date} />
                  </NewRowReveal>
                ) : (
                  <StaggerLine index={lineIndex++}>
                    <GroupHeader label={group.date} />
                  </StaggerLine>
                )}
                {group.items.map((item) =>
                  resolveRevealKind(item.id) === "insert" ? (
                    <NewRowReveal key={item.id}>
                      <TransactionRow
                        isSelected={selectedTransactionId === item.id}
                        item={item}
                        onSelect={() => onSelectTransaction(item)}
                      />
                    </NewRowReveal>
                  ) : (
                    <StaggerLine index={lineIndex++} key={item.id}>
                      <TransactionRow
                        isSelected={selectedTransactionId === item.id}
                        item={item}
                        onSelect={() => onSelectTransaction(item)}
                      />
                    </StaggerLine>
                  )
                )}
              </div>
            ));
            return (
              <>
                {renderedGroups}
                <StaggerLine index={lineIndex}>
                  <button
                    className="t-hover flex h-11 w-full items-center justify-center rounded-2xl font-medium text-[14px] text-foreground leading-5 hover:bg-accent"
                    onClick={onViewAllActivity}
                    type="button"
                  >
                    View all activity
                  </button>
                </StaggerLine>
              </>
            );
          })()}
        </StaggerReveal>
      ) : null}
    </div>
  );
}

function PositionsTab({
  holdings,
  onWithdrawSource,
}: {
  holdings: ActiveEarnPositionHolding[];
  onWithdrawSource: (sourceKey: string) => void;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const visibleHoldings = holdings.filter((holding) => {
    try {
      return BigInt(holding.amountRaw) > BigInt(0);
    } catch {
      return false;
    }
  });

  return (
    <StaggerReveal className="flex w-full flex-col p-2">
      {visibleHoldings.length === 0 ? (
        <p className="px-4 py-3 text-[13px] leading-4 text-muted-foreground">
          No positions.
        </p>
      ) : null}
      {visibleHoldings.map((holding, holdingIndex) => {
        const label =
          holding.kind === "idle"
            ? `${holding.label} ${holding.marketName}`
            : `${holding.marketName} USDC`;
        const amount = splitUsdBalance(
          rawTokenAmountToNumber(holding.amountRaw, 6)
        );
        return (
          <StaggerLine
            index={holdingIndex}
            key={`${holding.kind}:${
              holding.reserve ?? holding.market ?? label
            }`}
          >
            <div className="group t-hover flex w-full items-center rounded-2xl px-4 hover:bg-accent">
              <div className="flex items-center py-2 pr-3">
                <DualIcon
                  frontSrc={resolveEarnTransactionMarketIcon({
                    market: holding.market,
                  })}
                />
              </div>
              <div className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
                <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                  {label}
                </span>
                <p className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                  <ScrambleText
                    isHidden={isBalanceHidden}
                    text={amount.balanceWhole}
                  />
                  <span className="text-tertiary">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={amount.balanceFraction}
                    />
                  </span>
                </p>
              </div>
              {/* Reveal rides a short delay so quick pointer passes don't
                  flash the pill; un-hover drops the delay and hides at once. */}
              <div className="pointer-events-none flex pl-3 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-100">
                <button
                  className="t-hover min-w-16 rounded-full bg-accent px-4 py-2.5 text-center font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                  onClick={() =>
                    onWithdrawSource(getWithdrawSourceKeyForHolding(holding))
                  }
                  type="button"
                >
                  Withdraw
                </button>
              </div>
            </div>
          </StaggerLine>
        );
      })}
    </StaggerReveal>
  );
}

export function EarnActivityCard({
  executeNow,
  holdings,
  onSelectTransaction,
  onViewAllActivity,
  onWithdrawSource,
  pendingSignatures,
  refreshKey,
  scheduledSweeps,
  selectedTransactionId,
  settingsPda,
  walletAddress,
}: {
  executeNow: ExecuteNowControls;
  holdings: ActiveEarnPositionHolding[];
  onSelectTransaction: (item: EarnTransactionItem) => void;
  onViewAllActivity: () => void;
  onWithdrawSource: (sourceKey: string) => void;
  pendingSignatures: string[];
  refreshKey: number;
  scheduledSweeps: LoadedEarnAutodepositScheduledSweep[];
  selectedTransactionId: string | null;
  settingsPda: string | null | undefined;
  walletAddress: string | null;
}) {
  const [activeTab, setActiveTab] = useState<ActivityTab>("Transactions");

  // The card's height is content-driven (auto), which CSS alone can't tween
  // when tabs swap — so the switch measures the outgoing height at click,
  // then tweens to the incoming content's height on the t-resize clock
  // (transitions.dev card resize) and releases back to auto.
  const tabContentRef = useRef<HTMLDivElement>(null);
  const outgoingHeightRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);

  const selectTab = (tab: ActivityTab) => {
    if (tab !== activeTab) {
      outgoingHeightRef.current = tabContentRef.current?.offsetHeight ?? null;
      setActiveTab(tab);
    }
  };

  useLayoutEffect(() => {
    const el = tabContentRef.current;
    const fromHeight = outgoingHeightRef.current;
    outgoingHeightRef.current = null;
    if (!el || fromHeight === null) {
      return;
    }
    el.style.height = "";
    const toHeight = el.offsetHeight;
    if (fromHeight === toHeight) {
      return;
    }
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
    }
    el.style.height = `${fromHeight}px`;
    void el.offsetHeight;
    el.style.height = `${toHeight}px`;
    const dur = readCssDurationMs("--resize-dur", 300);
    // Async content (the transactions fetch) can land mid-tween, so the
    // pinned height retargets to the new content height instead of stalling
    // at the skeleton's and snapping on release.
    const observer = new ResizeObserver(() => {
      const content = el.firstElementChild as HTMLElement | null;
      if (!content) {
        return;
      }
      const next = content.offsetHeight;
      if (Math.abs(next - Number.parseFloat(el.style.height)) > 1) {
        el.style.height = `${next}px`;
        schedule();
      }
    });
    const schedule = () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        observer.disconnect();
        el.style.height = "";
      }, dur);
    };
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild);
    }
    schedule();
    return () => observer.disconnect();
  }, [activeTab]);

  useEffect(
    () => () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
    },
    []
  );

  // Same measure-and-tween mechanics as the chart tabs' sliding pill
  // (transitions.dev tabs sliding), skinned as the red underline. First paint
  // and resizes write the position with transitions suspended.
  const tabBarRef = useRef<HTMLDivElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);
  const hasPaintedTabs = useRef(false);
  const moveUnderlineToActiveTab = useCallback((animate: boolean) => {
    const bar = tabBarRef.current;
    const underline = underlineRef.current;
    const active = bar?.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]'
    );
    if (!(bar && underline && active)) {
      return;
    }
    // 12px inset matches the old per-button underline's inset-x-3.
    const write = () => {
      underline.style.transform = `translateX(${active.offsetLeft + 12}px)`;
      underline.style.width = `${active.offsetWidth - 24}px`;
    };
    if (animate) {
      write();
      return;
    }
    const previousTransition = underline.style.transition;
    underline.style.transition = "none";
    write();
    void underline.offsetWidth;
    underline.style.transition = previousTransition;
  }, []);

  useLayoutEffect(() => {
    moveUnderlineToActiveTab(hasPaintedTabs.current);
    hasPaintedTabs.current = true;
  }, [activeTab, moveUnderlineToActiveTab]);

  useEffect(() => {
    const handleResize = () => moveUnderlineToActiveTab(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [moveUnderlineToActiveTab]);

  return (
    // On mobile the card grows to meet the sticky action bar and drops its
    // bottom rounding (Figma 4693:70498).
    <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:flex-1 max-[795px]:rounded-b-none">
      <div
        className="relative flex w-full items-center px-2 pt-2"
        ref={tabBarRef}
        role="tablist"
      >
        <span
          aria-hidden="true"
          className="t-tabs-underline"
          ref={underlineRef}
        />
        {ACTIVITY_TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              aria-selected={isActive}
              className={`t-hover relative flex h-11 items-center justify-center px-4 font-medium text-[16px] leading-5 tracking-[-0.176px] ${
                isActive
                  ? "text-foreground"
                  : "rounded-3xl text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              key={tab}
              onClick={() => selectTab(tab)}
              role="tab"
              type="button"
            >
              {tab}
            </button>
          );
        })}
      </div>
      <div className="t-resize w-full overflow-clip" ref={tabContentRef}>
        {activeTab === "Transactions" ? (
          <TransactionsTab
            executeNow={executeNow}
            onSelectTransaction={onSelectTransaction}
            onViewAllActivity={onViewAllActivity}
            pendingSignatures={pendingSignatures}
            refreshKey={refreshKey}
            scheduledSweeps={scheduledSweeps}
            selectedTransactionId={selectedTransactionId}
            settingsPda={settingsPda}
            walletAddress={walletAddress}
          />
        ) : (
          <PositionsTab
            holdings={holdings}
            onWithdrawSource={onWithdrawSource}
          />
        )}
      </div>
    </section>
  );
}
