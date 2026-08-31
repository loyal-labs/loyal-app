"use client";

import {
  CircleCheck,
  Clock3,
  Infinity as InfinityIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  HistoricalApyChart,
  type HistoricalApySample,
} from "@/components/wallet-sidebar/earn-detail-view";
import {
  ScrambledPopDigits,
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { readCssDurationMs } from "@/components/wallet-workspace/facelift/css-duration";
import {
  type ChartCardCustomContent,
  type ChartTab,
  EarnChartPane,
} from "@/components/wallet-workspace/facelift/earn-chart-pane";
import {
  EarnMaxDepositPane,
  EarnMaxDualIcon,
  EarnMaxInfoFaqsCard,
  EarnMaxWithdrawPane,
  formatEarnMaxApyLabel,
} from "@/components/wallet-workspace/facelift/earn-max-action-panes";
import { EarnEmptyPane } from "@/components/wallet-workspace/facelift/earn-empty-pane";
import {
  EarnMaxTransactionDetailPane,
  earnMaxActivityLabel,
  formatEarnMaxUsdcAmount,
  isEarnMaxWithdrawishAction,
  OperationRow,
} from "@/components/wallet-workspace/facelift/earn-max-transaction-detail";
import { GroupHeader } from "@/components/wallet-workspace/facelift/earn-activity-card";
import {
  EarnedBarsChart,
  type EarnedChartBar,
} from "@/components/wallet-workspace/facelift/earned-chart";
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { isEscapeGuardedTarget } from "@/components/wallet-workspace/facelift/keyboard";
import {
  MiddlePaneSlide,
  PaneReveal,
} from "@/components/wallet-workspace/facelift/pane-transitions";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import {
  StaggerLine,
  StaggerReveal,
} from "@/components/wallet-workspace/facelift/stagger-reveal";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import {
  EARN_MAX_FALLBACK_APY_BPS,
  EARN_MAX_STRATEGY_NAME,
  type EarnMaxActions,
  type EarnMaxActivityItem,
  type EarnMaxViewModel,
} from "@/features/earn-max";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import { useAuthCapability } from "@/lib/auth/capability";

const ASSET_BASE = "/wallet-workspace/facelift";

// ponytail: the logged-out Strategies/Stats rail is a hardcoded design mock
// (Figma 5429:36788) until a public Earn MAX stats feed exists.
const MOCK_AVERAGE_NET_APY = "16.72%";
const MOCK_AUM = { fraction: ".54", whole: "$410,513" };
const MOCK_AUM_DELTA = "+$53,007.21 vs prior week";
const MOCK_OPTIMIZATION_VOLUME = { fraction: ".17", whole: "$2,462,602" };
const MOCK_TOTAL_USERS = "8,046";
const MOCK_AUM_BARS = [8, 73, 119, 157, 193, 227, 240];

function usdcRawLabel(amountRaw: string): string {
  return `${formatEarnMaxUsdcAmount(amountRaw)} USDC`;
}

function GrayInfinityIcon() {
  return (
    <span className="mr-3 flex size-11 shrink-0 items-center justify-center rounded-[11px] bg-accent">
      <InfinityIcon aria-hidden="true" className="size-6 text-foreground" />
    </span>
  );
}

function ApyBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-positive/[0.14] px-1 py-px">
      <span className="whitespace-nowrap pt-px font-medium text-[11px] text-positive leading-[13px] tracking-[0.06px]">
        {label}
      </span>
    </span>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <header className="flex w-full items-center p-2">
      <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
        {title}
      </h2>
    </header>
  );
}

// Figma 5429:36788 — logged-out right rail: Strategies + Stats, mock data.
export function EarnMaxMockRail() {
  return (
    <aside className="hidden h-full w-[400px] shrink-0 flex-col gap-2 overflow-y-auto min-[1204px]:flex">
      <div className="flex shrink-0 flex-col rounded-3xl bg-card">
        <PanelHeader title="Strategies" />
        <div className="flex w-full flex-col gap-2 px-2 pb-2">
          <div className="flex flex-col rounded-2xl bg-accent">
            <div className="flex w-full items-center px-4">
              <span className="flex items-center py-2">
                <GrayInfinityIcon />
              </span>
              <span className="min-w-0 flex-1 py-2 font-medium text-[16px] text-foreground leading-5">
                {EARN_MAX_STRATEGY_NAME}
              </span>
              {/* ponytail: mock tooltip copy — real copy comes with the
                  content pass */}
              <InfoTooltip
                iconClassName="size-6"
                text="A leveraged loop over tokenized real-world asset yield"
              />
            </div>
            <div className="flex flex-col gap-0.5 px-4 pt-2 pb-4">
              <span className="flex items-center gap-1">
                <span className="whitespace-nowrap text-[16px] text-muted-foreground leading-5">
                  Average Net APY
                </span>
                <InfoTooltip text="Average net yield after borrow costs and fees" />
              </span>
              <span className="font-semibold text-[28px] text-foreground leading-8">
                {MOCK_AVERAGE_NET_APY}
              </span>
            </div>
          </div>
          <div className="flex items-center rounded-2xl bg-accent px-4 opacity-40">
            <span className="flex items-center py-2">
              <span className="mr-3 flex size-11 shrink-0 items-center justify-center rounded-[11px] bg-accent">
                <ThemedIcon
                  className="size-6 text-foreground"
                  src={`${ASSET_BASE}/icon-clock.svg`}
                />
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
              <span className="font-medium text-[16px] text-foreground leading-5">
                Delta neutral
              </span>
              <span className="text-[13px] text-foreground leading-4">
                Coming soon
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col rounded-3xl bg-card pb-2">
        <PanelHeader title="Stats" />
        <div className="flex w-full flex-col gap-0.5 px-6 pt-2 pb-2">
          <span className="flex items-center gap-1">
            <span className="whitespace-nowrap text-[16px] text-muted-foreground leading-5">
              Earn AUM
            </span>
            <InfoTooltip text="Total assets managed across Earn strategies" />
          </span>
          <span className="font-semibold text-[40px] text-foreground leading-[48px]">
            {MOCK_AUM.whole}
            <span className="text-tertiary">{MOCK_AUM.fraction}</span>
          </span>
          <span className="text-[16px] text-positive leading-5">
            {MOCK_AUM_DELTA}
          </span>
        </div>
        <div className="flex w-full flex-col px-4">
          <div className="flex w-full items-center justify-between px-2 pb-2 text-[13px] text-muted-foreground leading-4">
            <span>Jul 26</span>
            <span>$420K</span>
          </div>
          <div className="flex h-60 w-full items-end justify-center gap-2 px-2">
            {MOCK_AUM_BARS.map((height, index) => (
              <div
                className={`min-w-px flex-1 rounded-[4px] bg-positive ${
                  index === MOCK_AUM_BARS.length - 2 ? "" : "opacity-20"
                }`}
                key={index}
                style={{ height: `${height}px` }}
              />
            ))}
          </div>
          <div className="flex w-full items-center justify-between px-2 py-2 text-[13px] text-muted-foreground leading-4">
            <span>Jun 1</span>
            <span>Jun 30</span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-0.5 px-6 pt-2 pb-2">
          <span className="flex items-center gap-1">
            <span className="whitespace-nowrap text-[16px] text-muted-foreground leading-5">
              Optimization Volume
            </span>
            <InfoTooltip text="Total volume routed by Earn optimization" />
          </span>
          <span className="font-semibold text-[40px] text-foreground leading-[48px]">
            {MOCK_OPTIMIZATION_VOLUME.whole}
            <span className="text-tertiary">
              {MOCK_OPTIMIZATION_VOLUME.fraction}
            </span>
          </span>
        </div>
        <div className="flex w-full flex-col gap-0.5 px-6 pt-2 pb-4">
          <span className="flex items-center gap-1">
            <span className="whitespace-nowrap text-[16px] text-muted-foreground leading-5">
              Total Users
            </span>
            <InfoTooltip text="Wallets that have used Earn" />
          </span>
          <span className="font-semibold text-[40px] text-foreground leading-[48px]">
            {MOCK_TOTAL_USERS}
          </span>
        </div>
      </div>
    </aside>
  );
}

// Earn MAX rides the shared Earn chart machinery (EarnChartPane: tabs pill,
// enlarged overlay, card motion) with its own two tabs and data — Earned bars
// derived from confirmed position snapshots, APY from the summary.
const EARN_MAX_CHART_TABS: readonly ChartTab[] = ["APY", "Earned"];

// ponytail: daily "earned" ≈ equity delta minus confirmed same-day flows
// (deposits in, withdrawal requests out) — replace with a dedicated earnings
// feed when the indexer grows one.
const EARNED_WINDOW_DAYS = 30;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function buildEarnMaxDailySeries(view: EarnMaxViewModel): {
  days: {
    date: Date;
    earnedUsd: number;
    equityUsd: number | null;
    isCurrent: boolean;
  }[];
} {
  // First and last confirmed equity per calendar day — the first one anchors
  // the position's opening day so its intra-day earnings still chart.
  const equityByDay = new Map<string, { first: number; last: number }>();
  for (const point of view.performance) {
    const date = new Date(point.timestamp);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const key = dayKey(date);
    const existing = equityByDay.get(key);
    if (existing) {
      existing.last = point.equityUsd;
    } else {
      equityByDay.set(key, { first: point.equityUsd, last: point.equityUsd });
    }
  }
  const flowsByDay = new Map<string, number>();
  for (const operation of view.activity) {
    if (!(operation.amountRaw && operation.timestamp)) {
      continue;
    }
    const date = new Date(operation.timestamp);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const sign =
      operation.action === "deposit" || operation.action === "install"
        ? 1
        : operation.action === "withdraw_request"
        ? -1
        : 0;
    if (sign === 0) {
      continue;
    }
    const key = dayKey(date);
    flowsByDay.set(
      key,
      (flowsByDay.get(key) ?? 0) + (sign * Number(operation.amountRaw)) / 1_000_000
    );
  }
  // Fixed window ending today, like the Earn earnings API — days without a
  // position render as empty bars so young positions still read as 30 days.
  const now = new Date();
  const days: {
    date: Date;
    earnedUsd: number;
    equityUsd: number | null;
    isCurrent: boolean;
  }[] = [];
  let carryEquity: number | null = null;
  for (let offset = EARNED_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = dayKey(date);
    const dayEquity = equityByDay.get(key);
    const equity: number | null = dayEquity?.last ?? carryEquity;
    const base = carryEquity ?? dayEquity?.first ?? null;
    const earned =
      base === null || equity === null
        ? 0
        : equity -
          base -
          (carryEquity === null ? 0 : flowsByDay.get(key) ?? 0);
    days.push({
      date,
      earnedUsd: earned,
      equityUsd: equity,
      isCurrent: offset === 0,
    });
    carryEquity = equity;
  }
  return { days };
}

function buildEarnMaxEarnedBars(view: EarnMaxViewModel): EarnedChartBar[] {
  return buildEarnMaxDailySeries(view).days.map((day) => ({
    apyBps: null,
    earnedUsd: day.earnedUsd,
    endAt: day.date.toISOString(),
    isCurrent: day.isCurrent,
    label: day.date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    }),
    startAt: day.date.toISOString(),
  }));
}

// Earn MAX rides Earn's animated HistoricalApyChart: days with confirmed
// history plot their realized daily APY, the rest sit at the realized /
// forecast figure — the Kamino benchmark lines stay for comparison.
function buildEarnMaxApySamples(view: EarnMaxViewModel): HistoricalApySample[] {
  const baselinePercent =
    (view.realizedApyBps ?? view.forecastApyBps ?? EARN_MAX_FALLBACK_APY_BPS) /
    100;
  return buildEarnMaxDailySeries(view).days.map((day) => {
    const dailyPercent =
      day.equityUsd && day.equityUsd > 0 && day.earnedUsd !== 0
        ? Math.max((day.earnedUsd / day.equityUsd) * 365 * 100, 0)
        : null;
    return {
      apyPercent: dailyPercent ?? baselinePercent,
      observedAtMs: day.date.getTime(),
    };
  });
}

function SmallPill({
  disabled = false,
  label,
  onClick,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant: "dark" | "light";
}) {
  return (
    <button
      className={`t-hover min-w-16 rounded-full px-4 py-2.5 text-center font-medium text-[13px] leading-4 disabled:opacity-40 ${
        variant === "dark"
          ? "bg-foreground text-background enabled:hover:bg-foreground/90"
          : "bg-accent text-foreground enabled:hover:bg-accent-active"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function GroupHeaderWithIcon({
  icon,
  label,
}: {
  icon: "check" | "clock";
  label: string;
}) {
  const Icon = icon === "check" ? CircleCheck : Clock3;
  return (
    <div className="flex w-full items-center gap-1 px-4 pt-4 pb-2">
      <Icon aria-hidden="true" className="size-5 text-tertiary" />
      <p className="min-w-0 flex-1 text-[16px] text-muted-foreground leading-5 tracking-[-0.176px]">
        {label}
      </p>
    </div>
  );
}

// Figma 5429:37504 — Transactions | Positions card with the withdrawal
// lifecycle (claim / cancel) pinned on top of the confirmed history.
const TRANSACTIONS_LIMIT = 5;

function minutesLeftLabel(readyBy: string): string {
  const msLeft = new Date(readyBy).getTime() - Date.now();
  if (!Number.isFinite(msLeft) || msLeft <= 0) {
    return "Finishing up";
  }
  return `~${Math.max(Math.ceil(msLeft / 60_000), 1)} min left`;
}

function EarnMaxActivityCard({
  actions,
  onSelectTransaction,
  onViewAllActivity,
  onWithdraw,
  selectedTransactionId,
  view,
}: {
  actions: EarnMaxActions;
  onSelectTransaction: (item: EarnMaxActivityItem) => void;
  onViewAllActivity: () => void;
  onWithdraw: () => void;
  selectedTransactionId: string | null;
  view: EarnMaxViewModel;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const [tab, setTab] = useState<"Positions" | "Transactions">(
    "Transactions"
  );

  // Same tab mechanics as EarnActivityCard: the content height is measured
  // at click and tweened on the t-resize clock, and the red underline slides
  // between tabs (transitions.dev tabs sliding).
  const tabContentRef = useRef<HTMLDivElement>(null);
  const outgoingHeightRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const selectTab = (next: "Positions" | "Transactions") => {
    if (next !== tab) {
      outgoingHeightRef.current = tabContentRef.current?.offsetHeight ?? null;
      setTab(next);
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
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      el.style.height = "";
    }, dur);
  }, [tab]);
  useEffect(
    () => () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
    },
    []
  );
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
  }, [tab, moveUnderlineToActiveTab]);
  useEffect(() => {
    const handleResize = () => moveUnderlineToActiveTab(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [moveUnderlineToActiveTab]);

  const withdrawal = view.withdrawal;
  // Recent-N card like the Earn activity card — the full feed lives on the
  // Activity page.
  const groups: { items: EarnMaxActivityItem[]; label: string }[] = [];
  for (const item of view.activity.slice(0, TRANSACTIONS_LIMIT)) {
    const label = item.timestamp
      ? new Date(item.timestamp).toLocaleDateString("en-US", {
          day: "numeric",
          month: "short",
        })
      : "Confirming";
    const group = groups.at(-1);
    if (group && group.label === label) {
      group.items.push(item);
    } else {
      groups.push({ items: [item], label });
    }
  }
  const balance = splitUsdBalance(view.balanceUsd);
  return (
    <div className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-none">
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
        {(["Transactions", "Positions"] as const).map((key) => {
          const isActive = tab === key;
          return (
            <button
              aria-selected={isActive}
              className={`t-hover relative flex h-11 items-center justify-center px-4 font-medium text-[16px] leading-5 tracking-[-0.176px] ${
                isActive
                  ? "text-foreground"
                  : "rounded-3xl text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              key={key}
              onClick={() => selectTab(key)}
              role="tab"
              type="button"
            >
              {key}
            </button>
          );
        })}
      </div>
      <div className="t-resize w-full overflow-clip" ref={tabContentRef}>
      <div className="flex w-full flex-col px-2 pb-2">
        {tab === "Positions" ? (
          view.balanceUsd > 0 ? (
            // Same row contract as the Earn Positions tab: 60px cell, amount
            // under the label, Withdraw pill on the delayed hover reveal.
            <StaggerReveal className="flex w-full flex-col">
              <StaggerLine index={0}>
                <div className="group t-hover flex w-full items-center rounded-2xl px-4 hover:bg-accent">
                  <div className="flex items-center py-2 pr-3">
                    <EarnMaxDualIcon />
                  </div>
                  <div className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
                    <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                      {EARN_MAX_STRATEGY_NAME} USDC
                    </span>
                    <p className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                      <ScrambleText
                        isHidden={isBalanceHidden}
                        text={balance.balanceWhole}
                      />
                      <span className="text-tertiary">
                        <ScrambleText
                          isHidden={isBalanceHidden}
                          text={balance.balanceFraction}
                        />
                      </span>
                    </p>
                  </div>
                  {/* Reveal rides a short delay so quick pointer passes don't
                      flash the pill; un-hover drops the delay and hides at
                      once. */}
                  <div className="pointer-events-none flex pl-3 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-100">
                    <SmallPill
                      label="Withdraw"
                      onClick={onWithdraw}
                      variant="light"
                    />
                  </div>
                </div>
              </StaggerLine>
            </StaggerReveal>
          ) : (
            <p className="px-4 py-3 text-[13px] text-muted-foreground leading-4">
              No positions.
            </p>
          )
        ) : view.isLoading && groups.length === 0 && !withdrawal ? (
          // Same pulse skeletons the Earn activity card boots with.
          <div className="t-skel-rows flex flex-col gap-2 px-4 py-3">
            {[0, 1, 2].map((index) => (
              <div className="h-[60px] w-full rounded-2xl bg-accent" key={index} />
            ))}
          </div>
        ) : (
          <StaggerReveal className="flex w-full flex-col">
            {(() => {
              let lineIndex = 0;
              return (
                <>
                  {withdrawal?.canClaim ? (
                    <StaggerLine index={lineIndex++}>
                      <GroupHeaderWithIcon icon="check" label="Ready to claim" />
                      <div className="flex w-full flex-col rounded-2xl">
                        <OperationRow
                          amountLabel={usdcRawLabel(withdrawal.amountRaw)}
                          isWithdraw
                          subtitle="Ready"
                          title="Withdraw"
                        />
                        <div className="flex w-full items-start gap-2 px-4 pt-1 pb-2">
                          <SmallPill
                            disabled={view.isBusy}
                            label="Claim withdrawal"
                            onClick={() => void actions.claim()}
                            variant="dark"
                          />
                          {withdrawal.canCancel ? (
                            <SmallPill
                              disabled={view.isBusy}
                              label="Cancel"
                              onClick={() => void actions.cancelWithdrawal()}
                              variant="light"
                            />
                          ) : null}
                        </div>
                      </div>
                    </StaggerLine>
                  ) : null}
                  {withdrawal &&
                  !withdrawal.canClaim &&
                  withdrawal.status !== "claimed" ? (
                    <StaggerLine index={lineIndex++}>
                      <GroupHeaderWithIcon icon="clock" label="Pending" />
                      <div className="flex w-full flex-col rounded-2xl">
                        <OperationRow
                          amountLabel={usdcRawLabel(withdrawal.amountRaw)}
                          isWithdraw
                          subtitle={minutesLeftLabel(withdrawal.readyBy)}
                          title="Withdraw"
                        />
                        {withdrawal.canCancel ? (
                          <div className="flex w-full items-start gap-2 px-4 pt-1 pb-2">
                            <SmallPill
                              disabled={view.isBusy}
                              label="Cancel"
                              onClick={() => void actions.cancelWithdrawal()}
                              variant="light"
                            />
                          </div>
                        ) : null}
                      </div>
                    </StaggerLine>
                  ) : null}
                  {groups.length === 0 && !withdrawal ? (
                    <p className="px-4 py-3 text-[13px] text-muted-foreground leading-4">
                      No transactions yet.
                    </p>
                  ) : (
                    <>
                      {groups.map((group) => (
                        <div className="flex w-full flex-col" key={group.label}>
                          <StaggerLine index={lineIndex++}>
                            <GroupHeader label={group.label} />
                          </StaggerLine>
                          {group.items.map((item) => (
                            <StaggerLine index={lineIndex++} key={item.id}>
                              <OperationRow
                                amountLabel={
                                  item.amountRaw
                                    ? usdcRawLabel(item.amountRaw)
                                    : null
                                }
                                isSelected={selectedTransactionId === item.id}
                                isWithdraw={isEarnMaxWithdrawishAction(
                                  item.action
                                )}
                                onSelect={() => onSelectTransaction(item)}
                                subtitle={
                                  item.timestamp
                                    ? new Date(
                                        item.timestamp
                                      ).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : "Confirming"
                                }
                                title={earnMaxActivityLabel(item)}
                              />
                            </StaggerLine>
                          ))}
                        </div>
                      ))}
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
                  )}
                </>
              );
            })()}
          </StaggerReveal>
        )}
      </div>
      </div>
    </div>
  );
}

// Figma 5429:37403 — signed-in Earn MAX home: balance + strategies card and
// the transactions card below it.
function EarnMaxMainPane({
  actions,
  onDeposit,
  onSelectTransaction,
  onViewAllActivity,
  onWithdraw,
  selectedTransactionId,
  view,
}: {
  actions: EarnMaxActions;
  onDeposit: () => void;
  onSelectTransaction: (item: EarnMaxActivityItem) => void;
  onViewAllActivity: () => void;
  onWithdraw: () => void;
  selectedTransactionId: string | null;
  view: EarnMaxViewModel;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const balance = splitUsdBalance(view.balanceUsd);
  const earnedLabel =
    view.earnedUsd === null
      ? null
      : `+$${view.earnedUsd.toLocaleString("en-US", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })}`;
  const canWithdraw = view.balanceUsd > 0;
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
      <div className="flex w-full shrink-0 flex-col rounded-3xl bg-card max-[795px]:rounded-t-none">
        <header className="flex w-full items-center p-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4">
            <h1 className="whitespace-nowrap font-semibold text-[24px] text-foreground leading-7">
              Earn MAX
            </h1>
            {/* ponytail: mock tooltip copy — real copy comes with the
                content pass */}
            <InfoTooltip
              iconClassName="size-6"
              placement="bottom"
              text="Higher-yield strategies through your own smart account"
            />
          </div>
          <div className="flex shrink-0 items-start gap-2 pl-3">
            <button
              className="t-hover flex items-center justify-center gap-2 rounded-full bg-accent p-2.5 enabled:hover:-translate-y-0.5 enabled:hover:bg-accent-active enabled:active:translate-y-0 disabled:opacity-40"
              disabled={!canWithdraw}
              onClick={onWithdraw}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-muted-foreground"
                src={`${ASSET_BASE}/icon-withdraw-arrow.svg`}
              />
              <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-foreground leading-5">
                Withdraw
              </span>
            </button>
            <button
              className="t-hover flex items-center justify-center gap-2 rounded-full bg-foreground p-2.5 hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
              onClick={onDeposit}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-background"
                src={`${ASSET_BASE}/icon-plus.svg`}
              />
              <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-background leading-5">
                Deposit
              </span>
            </button>
          </div>
        </header>
        <div className="flex w-full flex-col p-2 pt-0">
          <div className="flex w-full flex-col gap-0.5 px-4 py-2">
            <span className="flex items-center gap-1">
              <span className="whitespace-nowrap text-[16px] text-muted-foreground leading-5">
                Balance
              </span>
              <InfoTooltip text="Current equity of your Earn MAX position" />
            </span>
            <p className="whitespace-nowrap font-semibold text-[40px] text-foreground leading-[48px] tracking-[-0.44px]">
              <SkeletonReveal
                isRevealed={!view.isLoading}
                skeletonClassName="rounded-lg bg-accent-selected"
              >
                {view.isLoading ? (
                  `${balance.balanceWhole}${balance.balanceFraction}`
                ) : (
                  <ScrambledPopDigits
                    isHidden={isBalanceHidden}
                    segments={[
                      { text: balance.balanceWhole },
                      {
                        color: "var(--tertiary)",
                        text: balance.balanceFraction,
                      },
                    ]}
                  />
                )}
              </SkeletonReveal>
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col p-2 pt-0">
          {/* Hover swaps the value for the row-scoped Withdraw/Deposit
              pills (Figma 5465:82773) — same delayed reveal as the stables
              rows: quick pointer passes don't flash the buttons, un-hover
              drops the delay and hides immediately. */}
          <div className="group flex w-full items-center rounded-2xl px-4 transition-colors duration-150 hover:bg-accent">
            <span className="flex items-center py-2">
              <GrayInfinityIcon />
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1 py-2">
              <span className="whitespace-nowrap font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                {EARN_MAX_STRATEGY_NAME}
              </span>
              <ApyBadge label={formatEarnMaxApyLabel(view.forecastApyBps)} />
            </span>
            <div className="relative flex shrink-0 items-center justify-end pl-3">
              <div className="group-hover:pointer-events-none flex flex-col items-end justify-center gap-0.5 py-[11px] transition-opacity duration-150 group-hover:opacity-0">
                <span className="whitespace-nowrap text-right font-medium text-[16px] text-foreground leading-5">
                  <ScrambledPopDigits
                    isHidden={isBalanceHidden}
                    segments={[
                      { text: balance.balanceWhole },
                      {
                        color: "var(--tertiary)",
                        text: balance.balanceFraction,
                      },
                    ]}
                  />
                </span>
                {earnedLabel ? (
                  <span className="whitespace-nowrap text-[13px] text-positive leading-4">
                    {earnedLabel}
                  </span>
                ) : null}
              </div>
              <div className="pointer-events-none absolute right-0 flex items-center gap-2 rounded-[40px] bg-secondary opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-100">
                <SmallPill
                  disabled={!canWithdraw}
                  label="Withdraw"
                  onClick={onWithdraw}
                  variant="light"
                />
                <SmallPill label="Deposit" onClick={onDeposit} variant="dark" />
              </div>
            </div>
          </div>
          <div className="flex w-full items-center rounded-2xl px-4 opacity-40">
            <span className="flex items-center py-2">
              <span className="mr-3 flex size-11 shrink-0 items-center justify-center rounded-[11px] bg-accent">
                <ThemedIcon
                  className="size-6 text-foreground"
                  src={`${ASSET_BASE}/icon-clock.svg`}
                />
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
              <span className="whitespace-nowrap font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                Delta neutral
              </span>
              <span className="whitespace-nowrap text-[13px] text-foreground leading-4">
                Coming soon
              </span>
            </span>
          </div>
          {view.error ? (
            <p className="px-4 py-2 text-[13px] text-destructive leading-4">
              {view.error}
            </p>
          ) : null}
          {view.balanceUsd === 0 && view.status === "claimed" ? (
            <button
              className="t-hover self-start rounded-full px-4 py-2 font-medium text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground"
              disabled={view.isBusy}
              onClick={() => void actions.close()}
              type="button"
            >
              Close Earn MAX accounts &amp; reclaim rent
            </button>
          ) : null}
        </div>
      </div>
      <EarnMaxActivityCard
        actions={actions}
        onSelectTransaction={onSelectTransaction}
        onViewAllActivity={onViewAllActivity}
        onWithdraw={onWithdraw}
        selectedTransactionId={selectedTransactionId}
        view={view}
      />
    </section>
  );
}

// The Earn MAX section: connect teaser + mock rail when signed out; the live
// position workspace (main / deposit / withdraw screens) when signed in.
export function EarnMaxWorkspace({
  earnData,
  earnMax,
  onViewAllActivity,
}: {
  earnData: EarnPositionData;
  earnMax: { actions: EarnMaxActions; view: EarnMaxViewModel };
  onViewAllActivity: () => void;
}) {
  const { isHydrated, isSignedIn } = useAuthCapability();
  const [screen, setScreen] = useState<"deposit" | "main" | "withdraw">("main");
  const [chartTab, setChartTab] = useState<ChartTab | null>(null);
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<EarnMaxActivityItem | null>(null);
  // Keep the closing detail populated until its exit animation finishes
  // (same trick the shell uses for the Earn transaction detail).
  const lastTransactionRef = useRef<EarnMaxActivityItem | null>(null);
  if (selectedTransaction) {
    lastTransactionRef.current = selectedTransaction;
  }
  const transactionDetail = selectedTransaction ?? lastTransactionRef.current;
  useEffect(() => {
    if (isHydrated && !isSignedIn && screen !== "main") {
      setScreen("main");
    }
  }, [isHydrated, isSignedIn, screen]);
  useEffect(() => {
    if ((screen !== "main" || !isSignedIn) && selectedTransaction) {
      setSelectedTransaction(null);
    }
  }, [isSignedIn, screen, selectedTransaction]);
  // Esc closes the transaction detail first, then backs out of the action
  // screens (same contract as the Earn page).
  useEffect(() => {
    if (screen === "main" && !selectedTransaction) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isEscapeGuardedTarget(event.target)) {
        return;
      }
      queueMicrotask(() => {
        if (event.defaultPrevented) {
          return;
        }
        if (selectedTransaction) {
          setSelectedTransaction(null);
        } else {
          setScreen("main");
        }
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screen, selectedTransaction]);

  const { actions, view } = earnMax;
  const chartCustom: ChartCardCustomContent = {
    defaultTab: "Earned",
    renderBody: (activeTab) =>
      activeTab === "Earned" ? (
        <EarnedBarsChart
          bars={buildEarnMaxEarnedBars(view)}
          currentApyBps={view.realizedApyBps}
          isLoading={view.isLoading}
          isStale={false}
          isUnavailable={false}
          lifetimeEarnedUsd={view.earnedUsd ?? 0}
        />
      ) : (
        <HistoricalApyChart
          apyDataRevealed={!view.isLoading}
          axisTickCount={2}
          primaryLabel="Earn MAX"
          primarySamples={buildEarnMaxApySamples(view)}
          rangeId="30D"
        />
      ),
    tabs: EARN_MAX_CHART_TABS,
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
      <MiddlePaneSlide
        actionPane={
          screen === "deposit" ? (
            <EarnMaxDepositPane
              actions={actions}
              data={earnData}
              onBack={() => setScreen("main")}
              view={view}
            />
          ) : screen === "withdraw" ? (
            <EarnMaxWithdrawPane
              actions={actions}
              data={earnData}
              onBack={() => setScreen("main")}
              view={view}
            />
          ) : null
        }
      >
        {isHydrated && !isSignedIn ? (
          <PaneReveal>
            <EarnEmptyPane title="Earn MAX" />
          </PaneReveal>
        ) : !isHydrated ? (
          <section className="flex h-full min-w-0 flex-1 rounded-3xl bg-card max-[795px]:rounded-none" />
        ) : (
          <PaneReveal>
            <EarnMaxMainPane
              actions={actions}
              onDeposit={() => setScreen("deposit")}
              onSelectTransaction={(item) =>
                setSelectedTransaction((current) =>
                  current?.id === item.id ? null : item
                )
              }
              onViewAllActivity={onViewAllActivity}
              onWithdraw={() => setScreen("withdraw")}
              selectedTransactionId={selectedTransaction?.id ?? null}
              view={view}
            />
          </PaneReveal>
        )}
      </MiddlePaneSlide>
      {screen !== "main" ? null : isHydrated && !isSignedIn ? (
        <EarnMaxMockRail />
      ) : selectedTransaction && transactionDetail ? (
        <aside className="hidden h-full w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-card min-[1204px]:flex">
          <PaneReveal key={transactionDetail.id}>
            <EarnMaxTransactionDetailPane
              item={transactionDetail}
              onClose={() => setSelectedTransaction(null)}
              walletAddress={earnData.walletAddress ?? null}
            />
          </PaneReveal>
        </aside>
      ) : (
        <EarnChartPane
          custom={chartCustom}
          earnData={earnData}
          isExpanded={isChartExpanded}
          onExpandedChange={setIsChartExpanded}
          onSelectTab={setChartTab}
          selectedTab={chartTab}
          statsPanel={
            <EarnMaxInfoFaqsCard className="flex min-h-[240px] w-full flex-1" />
          }
        />
      )}
    </div>
  );
}
