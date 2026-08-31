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
  ScrambledPopDigits,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { readCssDurationMs } from "@/components/wallet-workspace/facelift/css-duration";
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
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { isEscapeGuardedTarget } from "@/components/wallet-workspace/facelift/keyboard";
import {
  MiddlePaneSlide,
  PaneReveal,
} from "@/components/wallet-workspace/facelift/pane-transitions";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import {
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

// Figma 5429:37577 — right-rail chart card. Earned totals come from the
// summary; the bars are daily equity deltas from confirmed snapshots.
// ponytail: no expanded overlay and no APY history feed yet — the APY tab
// shows the realized figure over the same bars.
function EarnMaxChartCard({ view }: { view: EarnMaxViewModel }) {
  const [tab, setTab] = useState<"apy" | "earned">("earned");
  const { isBalanceHidden } = useBalanceVisibility();
  const deltas: number[] = [];
  for (let index = 1; index < view.performance.length; index += 1) {
    deltas.push(
      view.performance[index]!.equityUsd - view.performance[index - 1]!.equityUsd
    );
  }
  const maxAbsDelta = deltas.reduce(
    (max, delta) => Math.max(max, Math.abs(delta)),
    0
  );
  const earned = splitUsdBalance(view.earnedUsd ?? 0);
  const apyLabel =
    view.realizedApyBps === null
      ? "—"
      : `${(view.realizedApyBps / 100).toFixed(2)}%`;
  return (
    <div className="flex shrink-0 flex-col rounded-3xl bg-card">
      <header className="flex w-full items-center justify-between p-2">
        <div className="flex items-center gap-1 rounded-full bg-accent p-1">
          {(["apy", "earned"] as const).map((key) => (
            <button
              className={`flex items-center justify-center rounded-full px-4 py-2 font-medium text-[14px] leading-5 ${
                tab === key
                  ? "bg-card text-foreground"
                  : "text-muted-foreground"
              }`}
              key={key}
              onClick={() => setTab(key)}
              type="button"
            >
              {key === "apy" ? "APY" : "Earned"}
            </button>
          ))}
        </div>
      </header>
      <div className="flex w-full flex-col gap-0.5 px-6 pt-2">
        <span className="text-[16px] text-muted-foreground leading-5">
          {tab === "earned" ? "Earned past 30 days" : "Realized APY"}
        </span>
        <span className="font-semibold text-[40px] text-foreground leading-[48px]">
          {tab === "earned" ? (
            <ScrambledPopDigits
              isHidden={isBalanceHidden}
              segments={[
                { text: earned.balanceWhole },
                { color: "var(--tertiary)", text: earned.balanceFraction },
              ]}
            />
          ) : (
            apyLabel
          )}
        </span>
      </div>
      <div className="flex w-full flex-col px-4 pt-4 pb-4">
        {deltas.length > 0 ? (
          <div className="flex h-40 w-full items-end justify-center gap-0.5 px-2">
            {deltas.slice(-40).map((delta, index) => {
              const height =
                maxAbsDelta > 0
                  ? Math.max((Math.abs(delta) / maxAbsDelta) * 100, 3)
                  : 3;
              return (
                <div
                  className={`min-w-px flex-1 rounded-[2px] ${
                    delta >= 0 ? "bg-positive" : "bg-primary"
                  }`}
                  key={index}
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex h-40 w-full items-center justify-center px-2 text-center text-[13px] text-muted-foreground leading-4">
            History appears after confirmed position snapshots.
          </div>
        )}
      </div>
    </div>
  );
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
            <div className="group flex w-full items-center rounded-2xl px-4 transition-colors duration-150 hover:bg-accent">
              <span className="flex items-center py-2 pr-3">
                <EarnMaxDualIcon />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                <span className="flex items-center gap-1">
                  <span className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                    {EARN_MAX_STRATEGY_NAME}
                  </span>
                  <ApyBadge label={formatEarnMaxApyLabel(view.forecastApyBps)} />
                </span>
                <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                  USDC
                </span>
              </span>
              <span className="whitespace-nowrap py-[11px] pl-3 text-right font-medium text-[16px] text-foreground leading-5 group-hover:hidden">
                {balance.balanceWhole}
                <span className="text-tertiary">{balance.balanceFraction}</span>
              </span>
              <span className="hidden items-center gap-2 py-3 pl-3 group-hover:flex">
                <SmallPill
                  label="Withdraw"
                  onClick={onWithdraw}
                  variant="light"
                />
                <SmallPill label="Deposit" onClick={onDeposit} variant="dark" />
              </span>
            </div>
          ) : (
            <p className="w-full py-6 text-center text-[14px] text-muted-foreground">
              No open positions yet.
            </p>
          )
        ) : (
          <>
            {withdrawal?.canClaim ? (
              <>
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
              </>
            ) : null}
            {withdrawal && !withdrawal.canClaim && withdrawal.status !== "claimed" ? (
              <>
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
              </>
            ) : null}
            {groups.length === 0 && !withdrawal ? (
              <p className="w-full py-6 text-center text-[14px] text-muted-foreground">
                No Earn MAX transactions yet.
              </p>
            ) : (
              <>
                {groups.map((group) => (
                <div className="flex w-full flex-col" key={group.label}>
                  <div className="flex w-full items-start px-4 pt-1">
                    <p className="min-w-0 flex-1 pt-3 pb-2 text-[16px] text-muted-foreground leading-5 tracking-[-0.176px]">
                      {group.label}
                    </p>
                  </div>
                  {group.items.map((item) => (
                    <OperationRow
                      amountLabel={
                        item.amountRaw ? usdcRawLabel(item.amountRaw) : null
                      }
                      isSelected={selectedTransactionId === item.id}
                      isWithdraw={isEarnMaxWithdrawishAction(item.action)}
                      key={item.id}
                      onSelect={() => onSelectTransaction(item)}
                      subtitle={
                        item.timestamp
                          ? new Date(item.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Confirming"
                      }
                      title={earnMaxActivityLabel(item)}
                    />
                  ))}
                </div>
                ))}
                <button
                  className="t-hover flex h-11 w-full items-center justify-center rounded-2xl font-medium text-[14px] text-foreground leading-5 hover:bg-accent"
                  onClick={onViewAllActivity}
                  type="button"
                >
                  View all activity
                </button>
              </>
            )}
          </>
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
          {/* Hovering the strategy row swaps its value for the row-scoped
              Withdraw/Deposit pills (Figma 5465:82773). */}
          <div className="group flex w-full items-center rounded-2xl px-4 hover:bg-accent">
            <span className="flex items-center py-2">
              <GrayInfinityIcon />
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1 py-2">
              <span className="whitespace-nowrap font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                {EARN_MAX_STRATEGY_NAME}
              </span>
              <ApyBadge label={formatEarnMaxApyLabel(view.forecastApyBps)} />
            </span>
            <span className="flex flex-col items-end gap-0.5 py-[11px] pl-3 group-hover:hidden">
              <span className="whitespace-nowrap text-right font-medium text-[16px] text-foreground leading-5">
                <ScrambledPopDigits
                  isHidden={isBalanceHidden}
                  segments={[
                    { text: balance.balanceWhole },
                    { color: "var(--tertiary)", text: balance.balanceFraction },
                  ]}
                />
              </span>
              {earnedLabel ? (
                <span className="whitespace-nowrap text-[13px] text-positive leading-4">
                  {earnedLabel}
                </span>
              ) : null}
            </span>
            <span className="hidden items-center gap-2 py-3 pl-3 group-hover:flex">
              <SmallPill
                disabled={!canWithdraw}
                label="Withdraw"
                onClick={onWithdraw}
                variant="light"
              />
              <SmallPill label="Deposit" onClick={onDeposit} variant="dark" />
            </span>
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
        onDeposit={onDeposit}
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
        <aside className="hidden h-full w-[400px] shrink-0 flex-col gap-2 min-[1204px]:flex">
          <EarnMaxChartCard view={view} />
          <EarnMaxInfoFaqsCard className="flex min-h-0 flex-1" />
        </aside>
      )}
    </div>
  );
}
