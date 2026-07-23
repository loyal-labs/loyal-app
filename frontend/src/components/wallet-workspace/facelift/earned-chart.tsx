"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  deriveEstimatedEarnedAmountApyBps,
  EARN_BALANCE_SAMPLE_MS,
  EARNINGS_DAILY_RANGE_ID,
  EARNINGS_LIFETIME_RANGE_ID,
  EarningsChartLoader,
  formatMaxDailyEarningsLabel,
  formatSignedEarningsAmount,
  splitEarningsHeaderValue,
} from "@/components/wallet-sidebar/earn-detail-view";
import {
  hiddenBalanceStyle,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useEarnEarnings } from "@/hooks/use-earn-earnings";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import { formatEarnApyPercent } from "@/lib/kamino/earn-forecast.shared";
import { rawTokenAmountToNumber } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import { deriveEarnEarningsDisplayAmounts } from "@/lib/yield-optimization/earnings-display.shared";

// Figma 4693:67592 (compact) / 4693:68575 (expanded) — bars are flex-1 so the
// wider expanded pane thickens them without extra layout rules.
const BAR_COLOR = "rgba(52, 199, 89, 0.4)";
const BAR_HOVER_COLOR = "rgba(52, 199, 89, 0.16)";
const TODAY_BAR_BORDER_COLOR = "#34c759";
const TODAY_BAR_HOVER_FILL =
  "linear-gradient(180deg, rgba(52, 199, 89, 0.6) 0%, rgba(52, 199, 89, 0) 100%)";
// Tallest bar tops out at 290/300 of the chart height in the Figma spec.
const BAR_MAX_FRACTION = 290 / 300;
const BAR_MIN_HEIGHT_PX = 4;

// The "good old" Earned chart re-skinned for the facelift right pane. Data and
// derivations mirror EarnDetailView/EarningsBlock exactly (same hook, same
// cache key recipe, same live-estimate math) — only the markup is new.
export function EarnedChart({ data }: { data: EarnPositionData }) {
  const publicEnv = usePublicEnv();
  const earnForecastApy = useEarnForecastApy();
  const { isBalanceHidden } = useBalanceVisibility();
  const hasPositiveCurrentBalance = data.hasPosition && data.earnBalanceUsd > 0;
  const earnEarningsRevalidationKey = data.position?.principalAmountRaw ?? "0";
  const earnEarningsCacheKey = [
    publicEnv.solanaEnv,
    data.walletAddress ?? "anonymous",
    data.settingsPda ?? "no-settings",
    "vault-1",
  ].join(":");
  const {
    data: earningsRangeSet,
    freshness: earningsFreshness,
    isLoading: isEarningsLoading,
    outcome: earningsOutcome,
    refresh: refreshEarnings,
  } = useEarnEarnings({
    cacheKey: earnEarningsCacheKey,
    enabled: hasPositiveCurrentBalance,
    revalidationKey: earnEarningsRevalidationKey,
    settingsPda: data.settingsPda,
    solanaEnv: publicEnv.solanaEnv,
    walletAddress: data.walletAddress,
  });
  const [earnLiveNowMs, setEarnLiveNowMs] = useState(() => Date.now());
  useEffect(() => {
    setEarnLiveNowMs(Date.now());
    const interval = window.setInterval(
      () => setEarnLiveNowMs(Date.now()),
      EARN_BALANCE_SAMPLE_MS
    );
    return () => window.clearInterval(interval);
  }, []);

  const lifetimeData =
    earningsRangeSet?.ranges[EARNINGS_LIFETIME_RANGE_ID] ?? null;
  const dailyData = earningsRangeSet?.ranges[EARNINGS_DAILY_RANGE_ID] ?? null;
  const principalAmount = data.position
    ? rawTokenAmountToNumber(data.position.principalAmountRaw, 6)
    : 0;
  const canLiveEstimate =
    earningsFreshness === "fresh" &&
    earningsRangeSet?.principalMatchesHistory === true &&
    lifetimeData?.currentApyBps !== null &&
    lifetimeData?.currentApyBps !== undefined;
  const estimatedEarnedAmounts = deriveEarnEarningsDisplayAmounts({
    apyBps: deriveEstimatedEarnedAmountApyBps({
      earningsData: lifetimeData,
      fallbackApyBps: earnForecastApy.apyBps,
    }),
    canLiveEstimate,
    dailyData,
    generatedAt: earningsRangeSet?.generatedAt ?? null,
    lifetimeData,
    nowMs: earnLiveNowMs,
    principalAmount,
  });
  const earningsUnavailable = earningsOutcome === "unavailable";
  const earningsStale = earningsFreshness === "stale";

  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const realBars = dailyData?.bars;
  const hasRealBars = (realBars?.length ?? 0) > 0;
  const showEarningsLoader = isEarningsLoading && !hasRealBars;
  const estimatedTodayEarnedUsd = estimatedEarnedAmounts.todayEarnedUsd;
  // Reconcile the in-progress bar against the live estimate, same as the old
  // EarningsBlock — prior bars stay daily (non-cumulative) values.
  const dailyBars = useMemo(
    () =>
      (realBars ?? []).map((bar) =>
        bar.isCurrent
          ? {
              ...bar,
              earnedUsd: Math.max(0, bar.earnedUsd, estimatedTodayEarnedUsd),
            }
          : bar
      ),
    [realBars, estimatedTodayEarnedUsd]
  );
  const maxDailyEarnedUsd = useMemo(
    () => dailyBars.reduce((max, bar) => Math.max(max, bar.earnedUsd), 0),
    [dailyBars]
  );
  const hoveredBarEntry =
    hoveredBar !== null ? dailyBars[hoveredBar] ?? null : null;
  const hoveredApyBps = hoveredBarEntry
    ? hoveredBarEntry.isCurrent
      ? dailyData?.currentApyBps ?? hoveredBarEntry.apyBps
      : hoveredBarEntry.apyBps
    : null;
  const hoveredDateLabel = hoveredBarEntry
    ? hoveredBarEntry.isCurrent
      ? `Today, ${hoveredBarEntry.label}`
      : hoveredBarEntry.label
    : "";
  const headerValue = splitEarningsHeaderValue(
    hoveredBarEntry
      ? Math.max(0, hoveredBarEntry.earnedUsd)
      : estimatedEarnedAmounts.rangeEarnedUsd
  );
  let headerSubtitle: ReactNode;
  if (!hoveredBarEntry) {
    headerSubtitle = earningsStale
      ? "Updating earnings…"
      : "Earned past 30 days";
  } else if (hoveredApyBps !== null) {
    headerSubtitle = `with ${formatEarnApyPercent(hoveredApyBps)} APY`;
  } else if (hoveredBarEntry.isCurrent) {
    headerSubtitle = `${hoveredBarEntry.label}, Now`;
  } else {
    headerSubtitle = hoveredDateLabel;
  }
  const hoveredDateRowLabel =
    hoveredBarEntry && hoveredApyBps !== null ? hoveredDateLabel : "";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <style jsx>{`
        .earned-bar {
          align-items: flex-end;
          background: transparent;
          border: none;
          cursor: pointer;
          display: flex;
          flex: 1 0 0;
          height: 100%;
          min-width: 0;
          padding: 0;
        }
        .earned-bar-fill {
          border-radius: 4px;
          box-sizing: border-box;
          display: block;
          transform-origin: center bottom;
          animation: earned-bar-rise 0.55s cubic-bezier(0.2, 0, 0, 1) both;
          animation-delay: calc(var(--bar-index, 0) * 14ms);
          transition: background 0.18s ease, border-color 0.18s ease;
          width: 100%;
        }
        @keyframes earned-bar-rise {
          from {
            transform: scaleY(0);
            opacity: 0;
          }
          to {
            transform: scaleY(1);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .earned-bar-fill {
            animation: none;
          }
        }
      `}</style>

      <div className="flex w-full flex-col gap-0.5 pb-2">
        <p className="truncate text-[16px] leading-5 text-[#8a8a8e]">
          {headerSubtitle}
        </p>
        <p
          className="font-semibold text-[40px] text-black leading-[48px]"
          style={hiddenBalanceStyle(isBalanceHidden, "lg")}
        >
          {earningsUnavailable ? (
            "Unavailable"
          ) : (
            <SkeletonReveal isRevealed={!showEarningsLoader}>
              {showEarningsLoader ? (
                // Invisible placeholder sizes the skeleton bar like a real
                // six-decimal earnings value.
                "$0.000000"
              ) : (
                <PopDigits
                  popOnChange={false}
                  segments={[
                    { text: `$${headerValue.whole}` },
                    { color: "#b1b1b4", text: `.${headerValue.fraction}` },
                  ]}
                />
              )}
            </SkeletonReveal>
          )}
        </p>
      </div>

      <div className="flex w-full justify-between pb-2 text-[13px] leading-4 text-[#8a8a8e]">
        <span>{hoveredDateRowLabel}</span>
        <span style={hiddenBalanceStyle(isBalanceHidden)}>
          {earningsUnavailable || showEarningsLoader
            ? ""
            : formatMaxDailyEarningsLabel(maxDailyEarnedUsd)}
        </span>
      </div>

      <div
        className="flex min-h-0 w-full flex-1 items-end gap-1.5 overflow-hidden"
        onMouseLeave={() => setHoveredBar(null)}
      >
        {earningsUnavailable ? (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-[13px] leading-4 text-[#8a8a8e]">
            <span>Earnings are temporarily unavailable.</span>
            <button
              className="t-hover rounded-full bg-black/[0.04] px-3 py-1.5 text-black hover:bg-black/[0.08]"
              onClick={refreshEarnings}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : showEarningsLoader ? (
          <EarningsChartLoader />
        ) : (
          dailyBars.map((bar, i) => {
            const isActive = hoveredBar === i;
            const fillPercent =
              maxDailyEarnedUsd > 0
                ? (Math.max(0, bar.earnedUsd) / maxDailyEarnedUsd) *
                  BAR_MAX_FRACTION *
                  100
                : 0;
            return (
              <button
                aria-label={`${bar.label} earned ${formatSignedEarningsAmount(
                  Math.max(0, bar.earnedUsd)
                )}`}
                className="earned-bar"
                key={`${bar.startAt}:${bar.endAt}`}
                onMouseEnter={() => setHoveredBar(i)}
                style={{
                  ["--bar-index" as never]: i,
                }}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="earned-bar-fill"
                  style={
                    bar.isCurrent
                      ? {
                          background: isActive
                            ? TODAY_BAR_HOVER_FILL
                            : "transparent",
                          border: `1px dashed ${TODAY_BAR_BORDER_COLOR}`,
                          height: `${fillPercent.toFixed(2)}%`,
                          minHeight:
                            bar.earnedUsd > 0 ? `${BAR_MIN_HEIGHT_PX}px` : 0,
                        }
                      : {
                          background: isActive ? BAR_HOVER_COLOR : BAR_COLOR,
                          height: `${fillPercent.toFixed(2)}%`,
                          minHeight:
                            bar.earnedUsd > 0 ? `${BAR_MIN_HEIGHT_PX}px` : 0,
                        }
                  }
                />
              </button>
            );
          })
        )}
        {dailyBars.length === 0 &&
        !showEarningsLoader &&
        !earningsUnavailable ? (
          <div className="flex h-full flex-1 items-center justify-center text-[13px] leading-4 text-[#8a8a8e]">
            No earnings yet
          </div>
        ) : null}
      </div>

      <div className="flex w-full justify-between pt-2 text-[13px] leading-4 text-[#8a8a8e]">
        <span className="whitespace-nowrap">{dailyBars[0]?.label ?? ""}</span>
        <span className="whitespace-nowrap">
          {dailyBars[dailyBars.length - 1]?.label ?? ""}
        </span>
      </div>
    </div>
  );
}
