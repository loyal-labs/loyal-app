"use client";

import { useState } from "react";

import {
  AutodepositToggle,
  splitEarnBalanceDisplay,
} from "@/components/wallet-sidebar/earn-detail-view";
import { AutodepositInfoOverlay } from "@/components/wallet-workspace/facelift/autodeposit-pane";
import {
  maskBalanceText,
  ScrambledPopDigits,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { EarnActivityCard } from "@/components/wallet-workspace/facelift/earn-activity-card";
import {
  EarnChartCard,
  type ChartTab,
} from "@/components/wallet-workspace/facelift/earn-chart-pane";
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { ApyRevealText } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useEarnForecastApyStatus } from "@/components/wallet-workspace/facelift/use-earn-forecast-apy-status";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { formatEarnApyLabel } from "@/lib/kamino/earn-forecast.shared";
import { formatAutodepositUsdLabel } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import type { EarnTransactionItem } from "@/lib/yield-optimization/earn-transactions.client";

const ASSET_BASE = "/wallet-workspace/facelift";

// Figma 4693:67399 (Transactions) / 4693:67728 (Positions) — Earn middle pane
// when a position exists: balance + autodeposit card, then the activity card.
// On mobile (Figma 4693:70364) the header actions move to a sticky bottom bar,
// the chart card renders inline between them, and the cards run full-bleed.
export function EarnPositionPane({
  data,
  onDeposit,
  onOpenAutodeposit,
  onOpenAutoswap,
  onOpenChart,
  onSelectChartTab,
  onSelectTransaction,
  onViewAllActivity,
  onWithdraw,
  selectedChartTab,
  selectedTransactionId,
}: {
  data: EarnPositionData;
  onDeposit: () => void;
  onOpenAutodeposit: () => void;
  onOpenAutoswap: () => void;
  onOpenChart: () => void;
  onSelectChartTab: (tab: ChartTab) => void;
  onSelectTransaction: (item: EarnTransactionItem) => void;
  onViewAllActivity: () => void;
  onWithdraw: (sourceKey?: string) => void;
  selectedChartTab: ChartTab | null;
  selectedTransactionId: string | null;
}) {
  const { apy, isLoaded: isApyLoaded } = useEarnForecastApyStatus();
  const autodeposit = data.autodepositConfig;
  const autoswap = data.autoswapConfig;
  const { isBalanceHidden } = useBalanceVisibility();
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  // Same toggle-state mapping as the old workspace's autodeposit card:
  // while toggling the knob optimistically shows the target position and the
  // hook reverts the state on failure.
  const autodepositState = autodeposit?.state ?? null;
  const isAutodepositToggling =
    autodepositState === "pausing" || autodepositState === "resuming";
  const autodepositLabel = autodeposit
    ? autodepositState === "pausing"
      ? "Pausing…"
      : autodepositState === "resuming"
      ? "Resuming…"
      : autodepositState === "paused"
      ? "Paused"
      : `Anything above ${formatAutodepositUsdLabel(autodeposit.keepAmount)}`
    : "Start earning the moment your money arrives";
  const autodepositLabelHasAmount = Boolean(
    autodeposit && !isAutodepositToggling && autodepositState !== "paused"
  );
  const isAutoswapToggling =
    autoswap?.status === "pausing" || autoswap?.status === "resuming";
  const autoswapLabel = autoswap
    ? autoswap.status === "on"
      ? `Up to $${(
          Number(autoswap.dailySourceMintSpendingCap) / 1_000_000
        ).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })}/day per stablecoin`
      : autoswap.status === "pausing"
      ? "Pausing…"
      : autoswap.status === "resuming"
      ? "Resuming…"
      : autoswap.status === "paused"
      ? "Paused"
      : autoswap.status === "finalizing"
      ? `Verifying ${autoswap.policies.length} of 2 policy permissions…`
      : "Paused"
    : "Move funds when another stablecoin route pays more";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto">
        <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-t-none">
          <header className="flex w-full items-center p-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4">
              <h1 className="whitespace-nowrap font-semibold text-[24px] text-foreground leading-7">
                Earn
              </h1>
              {/* ponytail: mock tooltip copy — real copy comes with the wiring pass */}
              <InfoTooltip
                iconClassName="size-6"
                placement="bottom"
                text="Earn yield on your idle USDC"
              />
            </div>
            <div className="flex shrink-0 items-start gap-2 pl-3 max-[795px]:hidden">
              <button
                className="t-hover flex items-center justify-center gap-2 rounded-full bg-accent p-2.5 hover:-translate-y-0.5 hover:bg-accent-active active:translate-y-0"
                onClick={() => onWithdraw()}
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

          <div className="w-full p-2">
            <div className="flex h-[86px] w-full flex-col items-start gap-0.5 rounded-[20px] px-4 py-2">
              <div className="flex items-start gap-1">
                <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                  {"Balance · "}
                  <span className="text-positive">
                    <ApyRevealText
                      isRevealed={isApyLoaded}
                      segments={[{ text: formatEarnApyLabel(apy.apyBps) }]}
                    />
                  </span>
                </p>
                <InfoTooltip text="Your balance grows at the current APY" />
              </div>
              {(() => {
                // Same display EarnGrowingBalance renders (its NumberFlow
                // timings are zeroed anyway), with pop-in digits; mobile font
                // clamp mirrors its ≤760px media query.
                const balance = splitEarnBalanceDisplay(data.earnBalanceUsd);
                return (
                  <p
                    className="whitespace-nowrap font-semibold text-[40px] leading-[46px] [font-variant-numeric:tabular-nums] max-[760px]:text-[clamp(30px,9.5vw,40px)] max-[760px]:leading-[1.08]"
                    style={{
                      color: isBalanceHidden
                        ? "var(--tertiary)"
                        : "var(--foreground)",
                    }}
                  >
                    <ScrambledPopDigits
                      isHidden={isBalanceHidden}
                      segments={[
                        { text: balance.whole },
                        {
                          color: "var(--tertiary)",
                          text: balance.fraction,
                        },
                      ]}
                    />
                  </p>
                );
              })()}
            </div>
          </div>

          <div className="w-full p-2">
            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11 shrink-0"
                  src={`${ASSET_BASE}/autodeposit-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                <p className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                  Autodeposit
                </p>
                {/* No truncate: the setup teaser must wrap on narrow screens
                    instead of clipping mid-word. */}
                <p className="text-[13px] leading-4 text-muted-foreground">
                  {/* Hiding masks the amount-bearing label through TextSwap's
                      own swap animation (churning it would thrash the swap). */}
                  <TextSwap
                    text={
                      autodepositLabelHasAmount && isBalanceHidden
                        ? maskBalanceText(autodepositLabel)
                        : autodepositLabel
                    }
                  />
                </p>
              </div>
              {autodeposit ? (
                <div className="flex items-center justify-end gap-1 pl-3">
                  <button
                    aria-label="Autodeposit settings"
                    className="t-hover flex size-11 items-center justify-center rounded-[20px] hover:bg-accent"
                    onClick={onOpenAutodeposit}
                    type="button"
                  >
                    <ThemedIcon
                      className="size-6 text-muted-foreground"
                      src={`${ASSET_BASE}/icon-settings-slider.svg`}
                    />
                  </button>
                  <AutodepositToggle
                    disabled={
                      autodeposit.state === "creating" || isAutodepositToggling
                    }
                    isOn={
                      isAutodepositToggling
                        ? autodeposit.state === "resuming"
                        : autodeposit.state !== "creating" &&
                          autodeposit.state !== "paused"
                    }
                    isPending={
                      isAutodepositToggling || autodeposit.state === "creating"
                    }
                    onToggle={data.toggleAutodeposit}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1 pl-3">
                  <button
                    aria-label="How Autodeposit works"
                    className="t-hover hidden size-11 items-center justify-center rounded-[20px] hover:bg-accent max-[795px]:flex"
                    onClick={() => setIsInfoOpen(true)}
                    type="button"
                  >
                    <ThemedIcon
                      className="size-6 text-tertiary"
                      src={`${ASSET_BASE}/icon-question.svg`}
                    />
                  </button>
                  <button
                    className="t-hover min-w-16 rounded-full bg-primary px-4 py-2.5 text-center font-medium text-[13px] text-white leading-4 hover:-translate-y-0.5 hover:bg-primary/90 active:translate-y-0"
                    onClick={onOpenAutodeposit}
                    type="button"
                  >
                    Set up
                  </button>
                </div>
              )}
            </div>
            {data.autodepositToggleError ? (
              <p className="px-4 pt-1 pb-2 text-[13px] leading-4 text-destructive">
                {data.autodepositToggleError}
              </p>
            ) : null}
            {data.autoswapAvailable || autoswap ? (
              <>
                <div className="flex w-full items-center rounded-2xl px-4">
                  <div className="py-2 pr-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      aria-hidden="true"
                      className="size-11 shrink-0"
                      src={`${ASSET_BASE}/autoswap-icon.svg`}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                    <p className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                      Autoswap
                    </p>
                    <p className="text-[13px] leading-4 text-muted-foreground">
                      <TextSwap text={autoswapLabel} />
                    </p>
                  </div>
                  {autoswap ? (
                    <div className="flex items-center gap-1 pl-3">
                      <button
                        aria-label="Autoswap settings"
                        className="t-hover flex size-11 items-center justify-center rounded-[20px] hover:bg-accent"
                        onClick={onOpenAutoswap}
                        type="button"
                      >
                        <ThemedIcon
                          className="size-6 text-muted-foreground"
                          src={`${ASSET_BASE}/icon-settings-slider.svg`}
                        />
                      </button>
                      <AutodepositToggle
                        ariaLabel={
                          autoswap.status === "on"
                            ? "Pause Autoswap"
                            : "Resume Autoswap"
                        }
                        disabled={
                          data.isAutoswapPending ||
                          autoswap.status === "finalizing"
                        }
                        isOn={
                          isAutoswapToggling
                            ? autoswap.status === "resuming"
                            : autoswap.status === "on"
                        }
                        isPending={
                          data.isAutoswapPending ||
                          isAutoswapToggling ||
                          autoswap.status === "finalizing"
                        }
                        onToggle={() => void data.toggleAutoswap()}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center pl-3">
                      <button
                        className="t-hover min-w-16 rounded-full bg-primary px-4 py-2.5 text-center font-medium text-[13px] text-white leading-4 hover:-translate-y-0.5 hover:bg-primary/90 active:translate-y-0"
                        onClick={onOpenAutoswap}
                        type="button"
                      >
                        Set up
                      </button>
                    </div>
                  )}
                </div>
                {data.autoswapError ? (
                  <p className="px-4 pt-1 pb-2 text-[13px] leading-4 text-destructive">
                    {data.autoswapError}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        {/* Mobile inline chart card between balance and activity
            (Figma 4693:70364); on desktop the chart lives in the right pane. */}
        <EarnChartCard
          actionAriaLabel="Expand chart"
          actionIconSrc={`${ASSET_BASE}/icon-expand.svg`}
          earnData={data}
          onAction={onOpenChart}
          onSelectTab={onSelectChartTab}
          sectionClassName="hidden h-[406px] w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:flex"
          selectedTab={selectedChartTab}
        />

        <EarnActivityCard
          executeNow={{
            error: data.actions.executeNowError,
            isPending: data.actions.isExecuteNowPending,
            progressBySlot: data.actions.autodepositProgressBySlot,
            run: data.actions.executeScheduledSweep,
          }}
          holdings={data.position?.holdings ?? []}
          onSelectTransaction={onSelectTransaction}
          onViewAllActivity={onViewAllActivity}
          onWithdrawSource={onWithdraw}
          pendingSignatures={data.actions.pendingTransactionSignatures}
          refreshKey={data.actions.earnTransactionsRefreshKey}
          scheduledSweeps={data.scheduledSweeps}
          selectedTransactionId={selectedTransactionId}
          settingsPda={data.settingsPda}
          walletAddress={data.walletAddress}
        />
      </div>

      {/* Mobile sticky action bar (Figma 4693:70601). */}
      <div className="hidden w-full shrink-0 bg-card px-4 py-2 max-[795px]:block">
        <div className="flex w-full gap-2">
          <button
            className="t-hover flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-foreground hover:bg-foreground/90"
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
          <button
            className="t-hover flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-accent hover:bg-accent-active"
            onClick={() => onWithdraw()}
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
        </div>
      </div>

      <AutodepositInfoOverlay
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
      />
    </div>
  );
}
