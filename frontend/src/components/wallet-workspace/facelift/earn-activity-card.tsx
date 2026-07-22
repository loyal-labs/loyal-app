"use client";

import { useEffect, useMemo, useState } from "react";

import { EarnYieldIcon } from "@/components/wallet-sidebar/portfolio-content";
import {
  hiddenBalanceStyle,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
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
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import type { ActiveEarnPositionHolding } from "@/hooks/use-active-earn-position";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import {
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

function UsdcCoinImage() {
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
      <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
        {source}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden="true"
        className="size-4"
        src={`${ASSET_BASE}/icon-arrow-right-circle.svg`}
      />
      <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
        {destination}
      </span>
    </span>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="flex w-full items-start px-4 pt-1">
      <p className="min-w-0 flex-1 pt-3 pb-2 text-[16px] leading-5 tracking-[-0.176px] text-[rgba(60,60,67,0.6)]">
        {label}
      </p>
    </div>
  );
}

function ScheduledSweepRow({
  sweep,
}: {
  sweep: LoadedEarnAutodepositScheduledSweep;
}) {
  const amountLabel = formatScheduledSweepAmount(sweep.remainingAmountRaw);
  const { isBalanceHidden } = useBalanceVisibility();

  return (
    <div className="flex w-full flex-col rounded-2xl">
      <div className="flex w-full items-start px-4">
        <div className="flex items-center py-2 pr-3">
          <DualIcon />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
            <p className="truncate font-medium text-[16px] text-black leading-5 tracking-[-0.176px]">
              Autodeposit
            </p>
            <p className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
              {formatScheduledSweepTime(sweep.eligibleAfter)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 py-[11px] pl-3">
            <p
              className="whitespace-nowrap text-[16px] text-black leading-5 text-right"
              style={hiddenBalanceStyle(isBalanceHidden)}
            >
              {amountLabel}
            </p>
            <RouteLabel destination="Earn" source="Main" />
          </div>
        </div>
      </div>
      <div className="flex w-full items-start px-4 pt-1 pb-2">
        {/* ponytail: execute-now action still lives in the old workspace's
            inline callbacks — disabled until write actions are wired. */}
        <button
          className="flex h-9 items-center justify-center rounded-full bg-black/[0.04] px-4 font-medium text-[14px] text-black leading-5 disabled:opacity-50"
          disabled
          type="button"
        >
          Execute now
        </button>
      </div>
    </div>
  );
}

function TransactionRow({ item }: { item: EarnTransactionItem }) {
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

  return (
    <div className="flex w-full items-center rounded-2xl px-4">
      <div className="flex items-center py-2 pr-3">
        {item.kind === "autodeposit_action" ? (
          <span className="inline-flex size-11 shrink-0 overflow-hidden rounded-full">
            <EarnYieldIcon />
          </span>
        ) : (
          <DualIcon
            backSrc={backSrc}
            frontSrc={frontSrc}
            isWithdraw={item.kind === "withdraw"}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <p className="truncate font-medium text-[16px] text-black leading-5 tracking-[-0.176px]">
          {getEarnTransactionRowLabel(item)}
        </p>
        <p className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          {timeLabel}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 py-[11px] pl-3">
        <p
          className="whitespace-nowrap text-[16px] leading-5 text-right"
          style={{
            color: getEarnTransactionAmountColor({ kind: item.kind }),
            ...hiddenBalanceStyle(isBalanceHidden),
          }}
        >
          {item.amount}
        </p>
        <RouteLabel
          destination={item.destination.label}
          source={item.source.label}
        />
      </div>
    </div>
  );
}

function TransactionsTab({
  scheduledSweeps,
  settingsPda,
  walletAddress,
}: {
  scheduledSweeps: LoadedEarnAutodepositScheduledSweep[];
  settingsPda: string | null | undefined;
  walletAddress: string | null;
}) {
  const publicEnv = usePublicEnv();
  const { isAuthenticated, isHydrated } = useAuthSession();
  const [items, setItems] = useState<EarnTransactionItem[] | null>(null);
  const [hasError, setHasError] = useState(false);

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

  return (
    <div className="flex w-full flex-col px-2 pb-2">
      {shouldShowScheduledSweepsSection(scheduledSweeps) ? (
        <>
          <div className="flex w-full items-start px-4 pt-1">
            <div className="flex min-w-0 flex-1 items-center gap-1 pt-3 pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-5"
                src={`${ASSET_BASE}/icon-clock.svg`}
              />
              <p className="min-w-0 flex-1 text-[16px] leading-5 tracking-[-0.176px] text-[rgba(60,60,67,0.6)]">
                Scheduled
              </p>
            </div>
          </div>
          {scheduledSweeps.map((sweep) => (
            <ScheduledSweepRow key={sweep.id} sweep={sweep} />
          ))}
        </>
      ) : null}

      {items === null && !hasError ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          {[0, 1, 2].map((index) => (
            <div
              className="h-[60px] w-full animate-pulse rounded-2xl bg-black/[0.04]"
              key={index}
            />
          ))}
        </div>
      ) : null}
      {hasError ? (
        <p className="px-4 py-3 text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          Failed to load transactions.
        </p>
      ) : null}
      {items !== null && items.length === 0 ? (
        <p className="px-4 py-3 text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          No transactions yet.
        </p>
      ) : null}

      {groups.map((group) => (
        <div className="flex w-full flex-col" key={group.date}>
          <GroupHeader label={group.date} />
          {group.items.map((item) => (
            <TransactionRow item={item} key={item.id} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PositionsTab({
  holdings,
}: {
  holdings: ActiveEarnPositionHolding[];
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
    <div className="flex w-full flex-col p-2">
      {visibleHoldings.length === 0 ? (
        <p className="px-4 py-3 text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          No positions.
        </p>
      ) : null}
      {visibleHoldings.map((holding) => {
        const label =
          holding.kind === "idle"
            ? `${holding.label} ${holding.marketName}`
            : `${holding.marketName} USDC`;
        const amount = splitUsdBalance(
          rawTokenAmountToNumber(holding.amountRaw, 6)
        );
        return (
          <div
            className="group flex w-full items-center rounded-2xl px-4 hover:bg-black/[0.04]"
            key={`${holding.kind}:${holding.reserve ?? holding.market ?? label}`}
          >
            <div className="flex items-center py-2 pr-3">
              <DualIcon
                frontSrc={resolveEarnTransactionMarketIcon({
                  market: holding.market,
                })}
              />
            </div>
            <div className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
              <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                {label}
              </span>
              <p
                className="whitespace-nowrap font-semibold text-[20px] text-black leading-6"
                style={hiddenBalanceStyle(isBalanceHidden)}
              >
                {amount.balanceWhole}
                <span className="text-[rgba(60,60,67,0.4)]">
                  {amount.balanceFraction}
                </span>
              </p>
            </div>
            <div className="hidden pl-3 group-hover:flex">
              <button
                className="min-w-16 rounded-full bg-black/[0.04] px-4 py-2.5 text-center font-medium text-[13px] text-black leading-4"
                type="button"
              >
                Withdraw
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EarnActivityCard({
  holdings,
  scheduledSweeps,
  settingsPda,
  walletAddress,
}: {
  holdings: ActiveEarnPositionHolding[];
  scheduledSweeps: LoadedEarnAutodepositScheduledSweep[];
  settingsPda: string | null | undefined;
  walletAddress: string | null;
}) {
  const [activeTab, setActiveTab] = useState<ActivityTab>("Transactions");

  return (
    // On mobile the card grows to meet the sticky action bar and drops its
    // bottom rounding (Figma 4693:70498).
    <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-white max-[795px]:flex-1 max-[795px]:rounded-b-none">
      <div className="flex w-full items-center px-2 pt-2">
        {ACTIVITY_TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              className={`relative flex h-11 items-center justify-center px-4 font-medium text-[16px] leading-5 tracking-[-0.176px] ${
                isActive
                  ? "text-black"
                  : "rounded-3xl text-[rgba(60,60,67,0.6)] hover:bg-black/[0.04] hover:text-black"
              }`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab}
              {isActive ? (
                <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-[4px] rounded-b-[1px] bg-[#f9363c]" />
              ) : null}
            </button>
          );
        })}
      </div>
      {activeTab === "Transactions" ? (
        <TransactionsTab
          scheduledSweeps={scheduledSweeps}
          settingsPda={settingsPda}
          walletAddress={walletAddress}
        />
      ) : (
        <PositionsTab holdings={holdings} />
      )}
    </section>
  );
}
