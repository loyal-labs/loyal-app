"use client";

import { useEffect, useState } from "react";

import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import type { EarnPublicStats } from "@/lib/yield-optimization/earn-public-stats.server";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";

const CHART_HEIGHT_PX = 240;
const MIN_BAR_HEIGHT_PX = 8;

// Tooltip copy mirrors dashboard/src/lib/performance-snapshot.ts — the public
// dashboard describing the same metrics.
const AUM_TOOLTIP =
  "Cumulative value deposited into our active Earn routing policies.";
const VOLUME_TOOLTIP =
  "Total USDC reallocated by confirmed Earn optimizations. This measures routing throughput across reserves, so the same deposited dollar can add to volume again when it is moved by a later optimization.";
const USERS_TOOLTIP = "Total wallet-based user accounts registered with Loyal.";

function formatCompactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function formatSignedUsd(value: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Math.abs(value));
  return `${value < 0 ? "-" : "+"}${formatted}`;
}

function StatValue({
  label,
  tooltip,
  value,
}: {
  label: string;
  tooltip: string;
  value: { balanceFraction: string | null; balanceWhole: string };
}) {
  return (
    <div className="flex w-full flex-col gap-0.5 px-4 py-2">
      <div className="flex items-center gap-1">
        <p className="text-[16px] leading-5 text-muted-foreground">{label}</p>
        <InfoTooltip text={tooltip} />
      </div>
      <p className="w-full font-semibold text-[40px] text-foreground leading-[48px]">
        {value.balanceWhole}
        {value.balanceFraction ? (
          <span className="text-tertiary">{value.balanceFraction}</span>
        ) : null}
      </p>
    </div>
  );
}

// The AUM bar chart (Figma 4884:37898 / hover 4884:36726): weekly buckets —
// the same series the public dashboard renders. Hovering highlights the bar
// and surfaces its week label top-left; the y-max rides top-right. The hover
// index lives in the panel so the AUM header can scrub to the hovered week
// (ASK-1915).
function AumBarChart({
  hoveredIndex,
  onHoveredIndexChange,
  series,
}: {
  hoveredIndex: number | null;
  onHoveredIndexChange: (index: number | null) => void;
  series: EarnPublicStats["aumSeries"];
}) {
  const maxValue = Math.max(...series.map((point) => point.value), 0);
  const firstPoint = series[0];
  const lastPoint = series.at(-1);
  const hoveredPoint = hoveredIndex === null ? null : series[hoveredIndex];

  if (series.length === 0 || maxValue <= 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col px-2 pb-2">
      {/* Same rise as the Earned chart's bars (earned-chart.tsx): scaleY from
          the baseline on a per-bar stagger. Fill stays "backwards" so the
          finished animation releases opacity back to the hover dimming. */}
      <style jsx>{`
        .stats-bar-fill {
          transform-origin: center bottom;
          animation: stats-bar-rise 0.55s cubic-bezier(0.2, 0, 0, 1) backwards;
          animation-delay: calc(var(--bar-index, 0) * 14ms);
        }
        @keyframes stats-bar-rise {
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
          .stats-bar-fill {
            animation: none;
          }
        }
      `}</style>
      <div className="flex w-full items-center justify-between px-4 pb-2 text-[13px] leading-4 text-tertiary">
        <p className={hoveredPoint ? "" : "invisible"}>
          {hoveredPoint?.label ?? " "}
        </p>
        <p>{formatCompactUsd(maxValue)}</p>
      </div>
      <div
        className="flex h-[240px] w-full items-end justify-center gap-2 px-4"
        onMouseLeave={() => onHoveredIndexChange(null)}
      >
        {series.map((point, index) => (
          <div
            className="h-full min-w-px flex-1 cursor-default"
            key={point.label}
            onMouseEnter={() => onHoveredIndexChange(index)}
          >
            <div className="flex h-full items-end">
              <div
                className="stats-bar-fill w-full rounded-[4px] transition-[background-color,opacity] duration-150"
                style={{
                  ["--bar-index" as string]: index,
                  backgroundColor:
                    hoveredIndex === index
                      ? "color-mix(in oklab, var(--positive) 60%, transparent)"
                      : "color-mix(in oklab, var(--positive) 40%, transparent)",
                  height: `${Math.max(
                    MIN_BAR_HEIGHT_PX,
                    Math.round((point.value / maxValue) * CHART_HEIGHT_PX)
                  )}px`,
                  opacity:
                    hoveredIndex === null || hoveredIndex === index ? 1 : 0.4,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex w-full items-start justify-between px-4 py-2 text-[13px] leading-4 text-tertiary">
        <p>{firstPoint?.label}</p>
        <p>{lastPoint?.label}</p>
      </div>
    </div>
  );
}

// Protocol-wide public stats card under the chart card (Figma 4884:37898) —
// the same numbers the public dashboard shows, via /api/earn/stats. Not
// user-scoped, so balance visibility does not scramble them.
export function EarnStatsPanel() {
  const [stats, setStats] = useState<EarnPublicStats | null>(null);
  const [hasError, setHasError] = useState(false);
  // Hovering an AUM bar scrubs the header to that week's value and its
  // vs-prior-week delta (ASK-1915); unhovered shows the live numbers.
  const [hoveredAumIndex, setHoveredAumIndex] = useState<number | null>(null);
  const hoveredAumPoint =
    stats !== null && hoveredAumIndex !== null
      ? stats.aumSeries[hoveredAumIndex] ?? null
      : null;
  const displayedAumUsd = hoveredAumPoint?.value ?? stats?.aumUsd ?? 0;
  const priorAumPoint =
    stats !== null && hoveredAumIndex !== null && hoveredAumIndex > 0
      ? stats.aumSeries[hoveredAumIndex - 1] ?? null
      : null;
  const displayedAumDeltaUsd = hoveredAumPoint
    ? priorAumPoint
      ? hoveredAumPoint.value - priorAumPoint.value
      : null
    : stats?.aumDeltaVsPriorWeekUsd ?? null;

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/earn/stats")
      .then((response) => {
        if (!response.ok) {
          throw new Error("earn_stats_unavailable");
        }
        return response.json() as Promise<EarnPublicStats>;
      })
      .then((value) => {
        if (isCurrent) {
          setStats(value);
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
  }, []);

  if (hasError) {
    return null;
  }

  return (
    <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card">
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
          Loyal Stats
        </h2>
      </header>
      {stats === null ? (
        <div className="t-skel-rows flex flex-col gap-2 px-6 pt-2 pb-6">
          <div className="h-[76px] w-full rounded-2xl bg-accent" />
          <div className="h-[240px] w-full rounded-2xl bg-accent" />
          <div className="h-[76px] w-full rounded-2xl bg-accent" />
        </div>
      ) : (
        <div className="flex w-full flex-col pb-4">
          <div className="flex w-full flex-col px-2 pt-2">
            <div className="flex w-full flex-col gap-0.5 px-4 py-2">
              <div className="flex items-center gap-1">
                <p className="text-[16px] leading-5 text-muted-foreground">
                  Earn AUM
                </p>
                <InfoTooltip text={AUM_TOOLTIP} />
              </div>
              <p className="w-full font-semibold text-[40px] text-foreground leading-[48px]">
                {splitUsdBalance(displayedAumUsd).balanceWhole}
                <span className="text-tertiary">
                  {splitUsdBalance(displayedAumUsd).balanceFraction}
                </span>
              </p>
              {/* Negative deltas are hidden, not shown in red — the stats
                  block advertises growth, not drawdowns. */}
              {displayedAumDeltaUsd !== null && displayedAumDeltaUsd > 0 ? (
                <p
                  className="text-[16px] leading-5"
                  style={{ color: "var(--positive)" }}
                >
                  {formatSignedUsd(displayedAumDeltaUsd)} vs prior week
                </p>
              ) : (
                // Keeps the slot height while scrubbing the first bucket,
                // which has no prior week to diff against.
                <p
                  aria-hidden="true"
                  className="invisible text-[16px] leading-5"
                >
                  &nbsp;
                </p>
              )}
            </div>
          </div>
          <AumBarChart
            hoveredIndex={hoveredAumIndex}
            onHoveredIndexChange={setHoveredAumIndex}
            series={stats.aumSeries}
          />
          <div className="flex w-full flex-col px-2 pt-2">
            <StatValue
              label="Optimization Volume"
              tooltip={VOLUME_TOOLTIP}
              value={splitUsdBalance(stats.optimizationVolumeUsd)}
            />
            <StatValue
              label="Total Users"
              tooltip={USERS_TOOLTIP}
              value={{
                balanceFraction: null,
                balanceWhole: stats.totalUsers.toLocaleString("en-US"),
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
