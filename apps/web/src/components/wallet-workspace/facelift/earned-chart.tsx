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
  ScrambledPopDigits,
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { getEarnEarningsCacheKey } from "@/components/wallet-workspace/facelift/earn-earnings-prefetch";
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
const BAR_COLOR = "color-mix(in srgb, var(--positive) 40%, transparent)";
const BAR_HOVER_COLOR = "color-mix(in srgb, var(--positive) 16%, transparent)";
const TODAY_BAR_BORDER_COLOR = "var(--positive)";
const TODAY_BAR_HOVER_FILL =
  "linear-gradient(180deg, color-mix(in srgb, var(--positive) 60%, transparent) 0%, transparent 100%)";
// Tallest bar tops out at 290/300 of the chart height in the Figma spec.
const BAR_MAX_FRACTION = 290 / 300;
const BAR_MIN_HEIGHT_PX = 4;

// One rendered daily bar — the shape EarnedBarsChart consumes. Earn feeds it
// from the earnings API; Earn MAX derives it from position snapshots.
export type EarnedChartBar = {
  apyBps: number | null;
  earnedUsd: number;
  endAt: string;
  isCurrent: boolean;
  label: string;
  startAt: string;
};

// The "good old" Earned chart re-skinned for the facelift right pane. Data and
// derivations mirror EarnDetailView/EarningsBlock exactly (same hook, same
// cache key recipe, same live-estimate math) — only the markup is new.
// Shared wiring for everything derived from the Earn earnings feed — the
// Earned chart consumes all of it, the wallet-home Earn card only the bars.
export function useEarnEarnedData(data: EarnPositionData) {
  const publicEnv = usePublicEnv();
  const earnForecastApy = useEarnForecastApy();
  const hasPositiveCurrentBalance = data.hasPosition && data.earnBalanceUsd > 0;
  const earnEarningsRevalidationKey = data.position?.principalAmountRaw ?? "0";
  const earnEarningsCacheKey = getEarnEarningsCacheKey({
    settingsPda: data.settingsPda ?? "no-settings",
    solanaEnv: publicEnv.solanaEnv,
    walletAddress: data.walletAddress ?? "anonymous",
  });
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

  return {
    currentApyBps: dailyData?.currentApyBps ?? null,
    dailyBars,
    earningsStale,
    earningsUnavailable,
    lifetimeEarnedUsd: estimatedEarnedAmounts.lifetimeEarnedUsd,
    refreshEarnings,
    showEarningsLoader,
  };
}

export function EarnedChart({ data }: { data: EarnPositionData }) {
  const earned = useEarnEarnedData(data);
  return (
    <EarnedBarsChart
      bars={earned.dailyBars}
      currentApyBps={earned.currentApyBps}
      isLoading={earned.showEarningsLoader}
      isStale={earned.earningsStale}
      isUnavailable={earned.earningsUnavailable}
      lifetimeEarnedUsd={earned.lifetimeEarnedUsd}
      onRetry={earned.refreshEarnings}
    />
  );
}

// Presentational half of the Earned chart — header, hover states and the
// animated daily bars. Earn and Earn MAX both render through this so the two
// products share one Earned chart implementation.
export function EarnedBarsChart({
  bars,
  currentApyBps,
  isLoading,
  isStale,
  isUnavailable,
  lifetimeEarnedUsd,
  onRetry,
}: {
  bars: EarnedChartBar[];
  currentApyBps: number | null;
  isLoading: boolean;
  isStale: boolean;
  isUnavailable: boolean;
  lifetimeEarnedUsd: number;
  onRetry?: () => void;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const dailyBars = bars;
  const earningsStale = isStale;
  const earningsUnavailable = isUnavailable;
  const showEarningsLoader = isLoading;
  const refreshEarnings = onRetry ?? (() => undefined);
  const maxDailyEarnedUsd = useMemo(
    () => dailyBars.reduce((max, bar) => Math.max(max, bar.earnedUsd), 0),
    [dailyBars]
  );
  // Earn's feed never goes below zero; Earn MAX equity can (drawdowns), so
  // the scale gains a baseline and loss bars drop under it in red.
  const minDailyEarnedUsd = useMemo(
    () => dailyBars.reduce((min, bar) => Math.min(min, bar.earnedUsd), 0),
    [dailyBars]
  );
  const hasNegativeBars = minDailyEarnedUsd < 0;
  const valueRange = maxDailyEarnedUsd - minDailyEarnedUsd;
  // Fraction of the chart height sitting below the zero line.
  const baselineFraction =
    hasNegativeBars && valueRange > 0
      ? Math.abs(minDailyEarnedUsd) / valueRange
      : 0;
  const hoveredBarEntry =
    hoveredBar !== null ? dailyBars[hoveredBar] ?? null : null;
  const hoveredApyBps = hoveredBarEntry
    ? hoveredBarEntry.isCurrent
      ? currentApyBps ?? hoveredBarEntry.apyBps
      : hoveredBarEntry.apyBps
    : null;
  const hoveredDateLabel = hoveredBarEntry
    ? hoveredBarEntry.isCurrent
      ? `Today, ${hoveredBarEntry.label}`
      : hoveredBarEntry.label
    : "";
  const headerRawValue = hoveredBarEntry
    ? hasNegativeBars
      ? hoveredBarEntry.earnedUsd
      : Math.max(0, hoveredBarEntry.earnedUsd)
    : lifetimeEarnedUsd;
  const headerValue = splitEarningsHeaderValue(Math.abs(headerRawValue));
  const headerSign = headerRawValue < 0 ? "-" : "";
  let headerSubtitle: ReactNode;
  if (!hoveredBarEntry) {
    headerSubtitle = earningsStale ? "Updating earnings…" : "Total earned";
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
          position: relative;
        }
        /* Full-height column track behind the bar — hover feedback stays
           visible even when the day's bar is tiny or absent. */
        .earned-bar-track {
          background: var(--accent);
          border-radius: 4px;
          inset: 0;
          opacity: 0;
          pointer-events: none;
          position: absolute;
          transition: opacity 0.18s ease;
        }
        .earned-bar:hover .earned-bar-track {
          opacity: 1;
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
        <p className="truncate text-[16px] leading-5 text-muted-foreground">
          {headerSubtitle}
        </p>
        <p className="font-semibold text-[40px] text-foreground leading-[48px]">
          {earningsUnavailable ? (
            "Unavailable"
          ) : (
            <SkeletonReveal isRevealed={!showEarningsLoader}>
              {showEarningsLoader ? (
                // Invisible placeholder sizes the skeleton bar like a real
                // six-decimal earnings value.
                "$0.000000"
              ) : (
                <ScrambledPopDigits
                  isHidden={isBalanceHidden}
                  popOnChange={false}
                  segments={[
                    { text: `${headerSign}$${headerValue.whole}` },
                    { color: "var(--tertiary)", text: `.${headerValue.fraction}` },
                  ]}
                />
              )}
            </SkeletonReveal>
          )}
        </p>
      </div>

      <div className="flex w-full justify-between pb-2 text-[13px] leading-4 text-tertiary">
        <span>{hoveredDateRowLabel}</span>
        <span>
          <ScrambleText
            isHidden={isBalanceHidden}
            text={
              earningsUnavailable || showEarningsLoader
                ? ""
                : formatMaxDailyEarningsLabel(maxDailyEarnedUsd)
            }
          />
        </span>
      </div>

      <div
        className="flex min-h-0 w-full flex-1 items-end gap-1.5 overflow-hidden"
        onMouseLeave={() => setHoveredBar(null)}
      >
        {earningsUnavailable ? (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-[13px] leading-4 text-muted-foreground">
            <span>Earnings are temporarily unavailable.</span>
            <button
              className="t-hover rounded-full bg-accent px-3 py-1.5 text-foreground hover:bg-accent-active"
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
            const clampedValue = hasNegativeBars
              ? bar.earnedUsd
              : Math.max(0, bar.earnedUsd);
            const scale = hasNegativeBars ? valueRange : maxDailyEarnedUsd;
            const fillPercent =
              scale > 0
                ? (Math.abs(clampedValue) / scale) * BAR_MAX_FRACTION * 100
                : 0;
            const isLoss = clampedValue < 0;
            // With losses in range every bar anchors to the shared zero
            // line; without them the original bottom-anchored layout stays.
            const anchorStyle = hasNegativeBars
              ? isLoss
                ? {
                    position: "absolute" as const,
                    top: `${(
                      (1 - baselineFraction * BAR_MAX_FRACTION) * 100
                    ).toFixed(2)}%`,
                    transformOrigin: "center top",
                  }
                : {
                    position: "absolute" as const,
                    bottom: `${(baselineFraction * BAR_MAX_FRACTION * 100).toFixed(2)}%`,
                  }
              : {};
            const fillColor = isLoss
              ? isActive
                ? "var(--destructive)"
                : "color-mix(in srgb, var(--destructive) 80%, transparent)"
              : isActive
              ? BAR_HOVER_COLOR
              : BAR_COLOR;
            return (
              <button
                aria-label={`${bar.label} earned ${formatSignedEarningsAmount(
                  clampedValue
                )}`}
                className="earned-bar"
                key={`${bar.startAt}:${bar.endAt}`}
                onMouseEnter={() => setHoveredBar(i)}
                style={{
                  ["--bar-index" as never]: i,
                }}
                type="button"
              >
                <span aria-hidden="true" className="earned-bar-track" />
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
                          ...anchorStyle,
                        }
                      : {
                          background: fillColor,
                          height: `${fillPercent.toFixed(2)}%`,
                          minHeight:
                            clampedValue !== 0 ? `${BAR_MIN_HEIGHT_PX}px` : 0,
                          ...anchorStyle,
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
          <div className="flex h-full flex-1 items-center justify-center text-[13px] leading-4 text-muted-foreground">
            No earnings yet
          </div>
        ) : null}
      </div>

      <div className="flex w-full justify-between pt-2 text-[13px] leading-4 text-tertiary">
        <span className="whitespace-nowrap">{dailyBars[0]?.label ?? ""}</span>
        {hasNegativeBars ? (
          // Loss floor reference (Figma 5459:71906's −$1.00 axis mark).
          <span className="whitespace-nowrap">
            <ScrambleText
              isHidden={isBalanceHidden}
              text={`-${formatMaxDailyEarningsLabel(
                Math.abs(minDailyEarnedUsd)
              )}`}
            />
          </span>
        ) : null}
        <span className="whitespace-nowrap">
          {dailyBars[dailyBars.length - 1]?.label ?? ""}
        </span>
      </div>
    </div>
  );
}
