"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ActivityRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import { PaneReveal } from "@/components/wallet-workspace/facelift/pane-transitions";
import type { WorkspacePage } from "@/components/wallet-workspace/facelift/shell";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import {
  StaggerLine,
  StaggerReveal,
} from "@/components/wallet-workspace/facelift/stagger-reveal";
import {
  TransactionDetailPane,
  type TransactionSwapDetail,
} from "@/components/wallet-workspace/facelift/transaction-detail-pane";
import { useWalletDesktopData } from "@/hooks/use-wallet-desktop-data";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

// The mapped ActivityRow keeps only one leg of a swap; the raw activity has
// both, so swap rows re-derive their display from it (two icons, from → to
// subtitle, the received leg as the amount). The detail pane needs the full
// two-leg shape on top.
type SwapDisplay = TransactionSwapDetail & {
  amountLabel: string;
};

function truncateAddress(addr: string): string {
  if (addr.length <= 12) {
    return addr;
  }
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

// Rows carry a preformatted "±1,010.22 USDC" amount — the symbol is its last
// word (used for shield-row subtitles and token icons, since the mapped row
// icon is the legacy shield art).
function parseSymbol(amount: string): string {
  return amount.trim().split(" ").pop() ?? "";
}

const ROW_TITLES: Record<ActivityRow["type"], string> = {
  received: "Received",
  sent: "Sent",
  shielded: "Shielded",
  unshielded: "Unshielded",
};

// Figma 4813:340209 — one activity cell: composite icon, type title, context
// subtitle, amount + time on the right.
function ActivityCell({
  isBalanceHidden,
  isSelected,
  onSelect,
  row,
  swap,
}: {
  isBalanceHidden: boolean;
  isSelected: boolean;
  onSelect: () => void;
  row: ActivityRow;
  swap: SwapDisplay | undefined;
}) {
  const isShieldType = row.type === "shielded" || row.type === "unshielded";
  const symbol = parseSymbol(row.amount);
  const tokenIcon = isShieldType ? getTokenIconUrl(symbol) : row.icon;
  const amount = swap ? swap.amountLabel : row.amount;
  const isPositive = amount.startsWith("+");

  return (
    <button
      className={`flex w-full items-center rounded-2xl px-4 text-left transition-colors duration-150 ${
        isSelected ? "bg-black/[0.04]" : "hover:bg-black/[0.04]"
      }`}
      onClick={onSelect}
      type="button"
    >
      <span className="flex shrink-0 items-center py-2 pr-3">
        <span className="relative block size-11 shrink-0">
          {swap ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="absolute top-0 left-0 size-[30px] rounded-full object-cover"
                src={swap.fromIcon}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="absolute right-0 bottom-0 size-[30px] rounded-full object-cover"
                src={swap.toIcon}
              />
            </>
          ) : isShieldType ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="absolute top-0 left-0 size-[30px] rounded-full object-cover"
                src={tokenIcon}
              />
              {row.type === "shielded" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="absolute right-px bottom-px size-7"
                  src={`${ASSET_BASE}/icon-shield-badge.svg`}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="-scale-x-100 absolute right-px bottom-px h-7 w-auto max-w-none"
                  src={`${ASSET_BASE}/icon-unshield-badge.svg`}
                />
              )}
            </>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="size-11 rounded-full object-cover"
                src={tokenIcon}
              />
              {row.isPrivate ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Private"
                  className="-bottom-0.5 -right-[3px] absolute size-5"
                  src={`${ASSET_BASE}/icon-shield-badge.svg`}
                />
              ) : null}
            </>
          )}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <span className="truncate font-medium text-[16px] text-black leading-5 tracking-[-0.176px]">
          {swap ? "Swapped" : row.titleOverride ?? ROW_TITLES[row.type]}
        </span>
        {swap ? (
          <span className="flex items-center gap-1">
            <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
              {swap.fromSymbol}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="to"
              className="size-4"
              src={`${ASSET_BASE}/icon-arrow-right-circle.svg`}
            />
            <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
              {swap.toSymbol}
            </span>
          </span>
        ) : (
          <span className="truncate text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
            {row.subtitle ??
              (isShieldType
                ? symbol
                : `${row.type === "received" ? "from" : "to"} ${truncateAddress(
                    row.counterparty
                  )}`)}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end justify-center gap-0.5 py-[11px] pl-3">
        <span
          className={`whitespace-nowrap text-right text-[16px] leading-5 ${
            isPositive ? "text-[#34c759]" : "text-black"
          }`}
        >
          <ScrambleText isHidden={isBalanceHidden} text={amount} />
        </span>
        <span className="whitespace-nowrap text-right text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          {row.timestamp}
        </span>
      </span>
    </button>
  );
}

// Activity screen (Figma 4813:339799 wide / 4813:340210 downsized): the
// wallet-only activity feed — the design's Earn/Wallet tabs are intentionally
// dropped (only wallet events exist here); an Earn Activity header pill
// points to the Earn page instead. Right pane (4813:340199) shows the OG
// transaction detail for the selected row, or the select-prompt placeholder.
export function ActivityPage({
  onSelectPage,
}: {
  onSelectPage: (page: WorkspacePage) => void;
}) {
  const data = useWalletDesktopData({});
  const { isBalanceHidden } = useBalanceVisibility();
  const [selectedDetail, setSelectedDetail] =
    useState<TransactionDetail | null>(null);
  // Keeps the last detail rendered through the sheet's close animation so
  // deselecting doesn't slide out an empty sheet.
  const lastDetailRef = useRef<TransactionDetail | null>(null);
  if (selectedDetail) {
    lastDetailRef.current = selectedDetail;
  }
  const sheetDetail = selectedDetail ?? lastDetailRef.current;

  // Activity is a lazy fetch — kick it on mount (no-op while signed out;
  // reruns when the wallet lands because loadActivity's identity changes).
  const [isActivityLoading, setIsActivityLoading] = useState(true);
  const loadActivity = data.loadActivity;
  useEffect(() => {
    let cancelled = false;
    setIsActivityLoading(true);
    void loadActivity().finally(() => {
      if (!cancelled) {
        setIsActivityLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadActivity]);

  const positions = data.positions;
  const swapDisplayById = useMemo(() => {
    const resolveLeg = (mint: string) => {
      const position = positions.find((entry) => entry.asset.mint === mint);
      // Same fallback the hook's own swap mapping uses.
      const symbol = position?.asset.symbol ?? "SOL";
      return {
        icon: position?.asset.imageUrl ?? getTokenIconUrl(symbol),
        symbol,
      };
    };
    const map = new Map<string, SwapDisplay>();
    for (const activity of data.walletActivities) {
      if (activity.type !== "swap") {
        continue;
      }
      const from = resolveLeg(activity.fromToken.mint);
      const to = resolveLeg(activity.toToken.mint);
      const fromNumber = parseFloat(activity.fromToken.amount.replace(/,/g, ""));
      const toNumber = parseFloat(activity.toToken.amount.replace(/,/g, ""));
      const rate =
        Number.isFinite(fromNumber) && Number.isFinite(toNumber) && toNumber > 0
          ? `1 ${to.symbol} = ${(fromNumber / toNumber).toLocaleString("en-US", {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            })} ${from.symbol}`
          : null;
      map.set(activity.signature, {
        amountLabel: `+${activity.toToken.amount} ${to.symbol}`,
        fromAmount: activity.fromToken.amount,
        fromIcon: from.icon,
        fromSymbol: from.symbol,
        rate,
        toAmount: activity.toToken.amount,
        toIcon: to.icon,
        toSymbol: to.symbol,
      });
    }
    return map;
  }, [data.walletActivities, positions]);

  const rows = data.allActivityRows;
  const groups = useMemo(() => {
    const result: { date: string; items: ActivityRow[] }[] = [];
    for (const row of rows) {
      const existing = result[result.length - 1];
      if (existing?.date === row.date) {
        existing.items.push(row);
      } else {
        result.push({ date: row.date, items: [row] });
      }
    }
    return result;
  }, [rows]);

  const showSkeleton = isActivityLoading && rows.length === 0;

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
        <PaneReveal>
          <section className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-3xl bg-white max-[795px]:rounded-none">
            <header className="flex w-full shrink-0 items-center p-2">
              <div className="flex min-w-0 flex-1 items-center py-2.5 pl-4">
                <h1 className="truncate whitespace-nowrap font-semibold text-[20px] text-black leading-6 max-[795px]:text-[24px] max-[795px]:leading-7">
                  Activity
                </h1>
              </div>
              <div className="flex shrink-0 items-start pl-3">
                <button
                  className="t-hover flex items-center justify-center gap-2 rounded-full bg-black/[0.04] p-2.5 hover:-translate-y-0.5 hover:bg-black/[0.08] active:translate-y-0"
                  onClick={() => onSelectPage("earn")}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="size-6"
                    src={`${ASSET_BASE}/icon-coins-add-gray.svg`}
                  />
                  <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-black leading-5">
                    Earn Activity
                  </span>
                </button>
              </div>
            </header>
            <div className="flex w-full flex-1 flex-col px-2 pb-2">
              {showSkeleton ? (
                // transitions.dev skeleton pulse, same rows the earn activity
                // card skeletons with.
                <div className="t-skel-rows flex flex-col gap-2 px-2 py-1">
                  {[0, 1, 2].map((index) => (
                    <div
                      className="h-[66px] w-full rounded-2xl bg-black/[0.04]"
                      key={index}
                    />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <p className="px-4 py-8 text-center text-[14px] leading-5 text-[rgba(60,60,67,0.6)]">
                  No activity yet
                </p>
              ) : (
                <StaggerReveal>
                  {groups.map((group, index) => (
                    <StaggerLine index={index} key={group.date}>
                      <div className="flex items-start px-4 pt-1">
                        <p className="min-w-0 flex-1 pt-3 pb-2 text-[16px] leading-5 text-[rgba(60,60,67,0.6)] tracking-[-0.176px]">
                          {group.date}
                        </p>
                      </div>
                      {group.items.map((row) => (
                        <ActivityCell
                          isBalanceHidden={isBalanceHidden}
                          isSelected={selectedDetail?.activity.id === row.id}
                          key={row.id}
                          onSelect={() => {
                            const detail = data.transactionDetails[row.id];
                            if (detail) {
                              setSelectedDetail(detail);
                            }
                          }}
                          row={row}
                          swap={swapDisplayById.get(row.id)}
                        />
                      ))}
                    </StaggerLine>
                  ))}
                </StaggerReveal>
              )}
            </div>
          </section>
        </PaneReveal>
        {selectedDetail ? (
          <aside className="hidden h-full w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-white min-[1204px]:flex">
            {/* Keyed by tx so switching rows replays the reveal — same as
                the send flow's per-step PaneReveal. */}
            <PaneReveal key={selectedDetail.activity.id}>
              <TransactionDetailPane
                detail={selectedDetail}
                onClose={() => setSelectedDetail(null)}
                swap={swapDisplayById.get(selectedDetail.activity.id)}
                walletAddress={data.walletAddress}
              />
            </PaneReveal>
          </aside>
        ) : (
          <aside className="hidden h-full w-[400px] shrink-0 flex-col items-center justify-center overflow-clip rounded-3xl border-2 border-black/10 border-dashed min-[1204px]:flex">
            <div className="flex w-full flex-col items-center gap-4 px-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-11"
                src={`${ASSET_BASE}/icon-cursor-click.svg`}
              />
              <p className="text-center text-[16px] leading-5 text-[#8a8a8e] tracking-[-0.176px]">
                Select a transaction to view its details
              </p>
            </div>
          </aside>
        )}
      </div>
      <MobileTabBar activeTab="activity" onSelect={onSelectPage} />
      {/* Below 1204px the right pane is gone, so the same selection opens the
          detail as the chart-enlarge sheet (Figma 4813:366475): a 400px
          right-pinned card on the dark scrim, a full bottom sheet on the
          white one below 796px. On desktop the scrim is display:none, so the
          mounted sheet is inert while the aside shows the detail. */}
      <SheetReveal
        isOpen={selectedDetail !== null}
        onClose={() => setSelectedDetail(null)}
        scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8 min-[1204px]:hidden"
        sheetClassName="ml-auto flex h-full w-[400px] min-w-0 flex-col overflow-clip rounded-3xl bg-white max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
      >
        {sheetDetail ? (
          <TransactionDetailPane
            detail={sheetDetail}
            key={sheetDetail.activity.id}
            onClose={() => setSelectedDetail(null)}
            swap={swapDisplayById.get(sheetDetail.activity.id)}
            walletAddress={data.walletAddress}
          />
        ) : null}
      </SheetReveal>
    </>
  );
}
