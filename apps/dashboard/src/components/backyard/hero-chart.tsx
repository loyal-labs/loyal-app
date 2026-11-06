"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { type DailyPrice, windowApy } from "@/lib/backyard/math";

import { compactUsd, pct, shortDate, usd } from "./format";

const TABS = ["APY", "Breakdown", "TVL"] as const;
const RANGES = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 365, label: "1Y" },
] as const;
type Tab = (typeof TABS)[number];

export type HeroChartProps = {
  apy: {
    current: { lane: string | null; pct: number } | null;
    daily: DailyPrice[];
    history: Array<{ at: string; sevenDayApy: number | null }>;
    priceNow: number;
  } | null;
  breakdown: {
    lane: string;
    points: Array<{ at: string; borrowPct: number; supplyPct: number }>;
  } | null;
  moveDays: string[];
  nowIso: string;
  tvl: {
    exposureUsd: number | null;
    points: Array<{ at: string; value: number }>;
    totalUsd: number | null;
  } | null;
};

function Segmented<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly { label: string; value: T }[];
  value: T;
}) {
  return (
    <div
      aria-label={label}
      className="inline-flex rounded-full border bg-muted p-1"
      role="tablist"
    >
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
            option.value === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

/** Three evenly spaced ticks: start, middle, end (as on liftedfi). */
function edgeTicks(points: Array<{ at: string }>) {
  if (points.length < 3) return points.map((p) => p.at);
  return [
    points[0].at,
    points[Math.floor(points.length / 2)].at,
    points[points.length - 1].at,
  ];
}

function TooltipBox({
  active,
  format,
  label,
  payload,
}: {
  active?: boolean;
  format: (name: string, value: number) => string;
  label?: string;
  payload?: Array<{ dataKey?: unknown; name?: unknown; value?: unknown }>;
}) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(
    (item) =>
      typeof item.value === "number" &&
      item.dataKey !== "base" &&
      item.dataKey !== "spread"
  );
  if (!items.length) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 text-muted-foreground">{shortDate(label)}</p>
      {items.map((item) => (
        <p className="font-mono tabular-nums" key={String(item.dataKey)}>
          {format(String(item.name ?? item.dataKey), Number(item.value))}
        </p>
      ))}
    </div>
  );
}

export function HeroChart({
  apy,
  breakdown,
  moveDays,
  nowIso,
  tvl,
}: HeroChartProps) {
  const [tab, setTab] = useState<Tab>("APY");
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("30D");
  const days = RANGES.find((r) => r.label === range)!.days;
  const nowMs = Date.parse(nowIso);
  const from = nowMs - days * 86_400_000;
  const inRange = <P extends { at: string }>(points: P[]) =>
    points.filter((point) => Date.parse(point.at) >= from);

  const apyPoints = inRange(apy?.history ?? []).map((point) => ({
    at: point.at,
    value: point.sevenDayApy === null ? null : point.sevenDayApy * 100,
  }));
  const average = apy ? windowApy(apy.daily, apy.priceNow, nowMs, days) : null;
  // Fewer days of history than the range: say how many days it really covers.
  const averageLabel =
    average && average.days < days - 1
      ? `Since ${shortDate(average.since)}`
      : `${range} avg`;

  const breakdownPoints = inRange(breakdown?.points ?? []).map((point) => ({
    ...point,
    // Stacked: an invisible base up to the borrow rate, then the spread.
    base: point.borrowPct,
    spread: Math.max(point.supplyPct - point.borrowPct, 0),
  }));
  const breakdownDomain = ((): [number | "auto", number | "auto"] => {
    const values = breakdownPoints.flatMap((p) => [p.borrowPct, p.supplyPct]);
    if (!values.length) return ["auto", "auto"];
    return [
      Math.floor(Math.min(...values) - 1),
      Math.ceil(Math.max(...values) + 1),
    ];
  })();
  const markerDays = new Set(moveDays);
  const markers = breakdownPoints.filter((point) =>
    markerDays.has(point.at.slice(0, 10))
  );
  const latestSpread = breakdownPoints.at(-1);

  const tvlPoints = inRange(tvl?.points ?? []);

  const chartPoints =
    tab === "APY" ? apyPoints : tab === "TVL" ? tvlPoints : breakdownPoints;
  const empty = chartPoints.length < 2;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex justify-center">
        <Segmented
          label="Chart"
          onChange={setTab}
          options={TABS.map((value) => ({ label: value, value }))}
          value={tab}
        />
      </div>

      <div className="min-h-[92px]">
        {tab === "APY" ? (
          <>
            <Kicker>{averageLabel}</Kicker>
            <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight md:text-5xl">
              {average ? `${pct(average.apy * 100)} APY` : "—"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Current position:{" "}
              <span className="font-medium text-foreground">
                {apy?.current ? pct(apy.current.pct) : "—"}
              </span>
              {apy?.current?.lane ? ` · ${apy.current.lane}` : ""}
            </p>
          </>
        ) : tab === "Breakdown" ? (
          <>
            <Kicker>
              {range} · {breakdown?.lane ?? "lane"}
            </Kicker>
            <p className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
              Breakdown
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Spread today:{" "}
              <span className="font-medium text-foreground">
                {latestSpread
                  ? `${pct(
                      latestSpread.supplyPct - latestSpread.borrowPct
                    )} pts`
                  : "—"}
              </span>{" "}
              before leverage
            </p>
          </>
        ) : (
          <div className="flex flex-wrap gap-x-12 gap-y-4">
            <div>
              <Kicker>Total exposure</Kicker>
              <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight md:text-5xl">
                {compactUsd(tvl?.exposureUsd)}
              </p>
            </div>
            <div>
              <Kicker>TVL</Kicker>
              <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight md:text-5xl">
                {compactUsd(tvl?.totalUsd)}
              </p>
            </div>
          </div>
        )}
      </div>

      {tab === "Breakdown" ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded bg-success" /> Supply APY
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded bg-warning" /> Borrow APY
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-4 rounded-sm bg-success/15" /> Spread
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full border-2 border-success" />{" "}
            Position change
          </span>
        </div>
      ) : null}

      <div className="h-[340px] w-full min-w-0 md:h-[420px]">
        {empty ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            Not enough history for this range yet.
          </div>
        ) : (
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart
              data={chartPoints}
              margin={{ bottom: 0, left: 0, right: 8, top: 8 }}
            >
              <defs>
                <pattern
                  height="6"
                  id="backyard-dots"
                  patternUnits="userSpaceOnUse"
                  width="6"
                >
                  <circle
                    cx="1"
                    cy="1"
                    fill="var(--foreground)"
                    opacity="0.12"
                    r="0.8"
                  />
                </pattern>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="at"
                interval="preserveStartEnd"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={shortDate}
                tickLine={false}
                ticks={edgeTicks(chartPoints)}
              />
              <YAxis
                axisLine={false}
                allowDataOverflow={tab === "Breakdown"}
                domain={
                  tab === "Breakdown" ? breakdownDomain : ["auto", "auto"]
                }
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(value: number) =>
                  tab === "TVL" ? compactUsd(value) : pct(value, 1)
                }
                tickLine={false}
                width={tab === "TVL" ? 64 : 52}
              />
              <Tooltip
                content={
                  <TooltipBox
                    format={(name, value) =>
                      tab === "TVL"
                        ? `TVL ${usd(value)}`
                        : `${name} ${pct(value)}`
                    }
                  />
                }
                cursor={{ stroke: "var(--border)" }}
              />
              {tab === "Breakdown" ? (
                [
                  <Area
                    key="base"
                    activeDot={false}
                    dataKey="base"
                    fill="none"
                    isAnimationActive={false}
                    stackId="breakdown"
                    stroke="none"
                    type="monotone"
                  />,
                  <Area
                    key="spread"
                    activeDot={false}
                    dataKey="spread"
                    fill="var(--success)"
                    fillOpacity={0.12}
                    isAnimationActive={false}
                    stackId="breakdown"
                    stroke="none"
                    type="monotone"
                  />,
                  <Line
                    key="supply"
                    dataKey="supplyPct"
                    dot={false}
                    isAnimationActive={false}
                    name="Supply"
                    stroke="var(--success)"
                    strokeWidth={1.75}
                    type="monotone"
                  />,
                  <Line
                    key="borrow"
                    dataKey="borrowPct"
                    dot={false}
                    isAnimationActive={false}
                    name="Borrow"
                    stroke="var(--warning)"
                    strokeWidth={1.75}
                    type="monotone"
                  />,
                  ...markers.map((point) => (
                    <ReferenceDot
                      fill="var(--card)"
                      key={point.at}
                      r={4}
                      stroke="var(--success)"
                      strokeWidth={2}
                      x={point.at}
                      y={point.supplyPct}
                    />
                  )),
                ]
              ) : (
                <Area
                  connectNulls
                  dataKey="value"
                  dot={false}
                  fill="url(#backyard-dots)"
                  isAnimationActive={false}
                  name={tab === "APY" ? "7-day APY" : "TVL"}
                  stroke="var(--foreground)"
                  strokeWidth={1.75}
                  type="monotone"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex justify-center">
        <Segmented
          label="Range"
          onChange={setRange}
          options={RANGES.map((r) => ({ label: r.label, value: r.label }))}
          value={range}
        />
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        {tab === "APY"
          ? "Line: 7-day realized APY from the Voltr share price at the end of each UTC day; the last point is now. Average: share price now against the start of the range, compounded to a year, after all costs. Current position: the worker's forecast for the live position."
          : tab === "Breakdown"
          ? "From Kamino daily reserve history for the vault's current lane. Supply APY is the collateral's own yield plus Kamino supply interest; borrow APY is the debt reserve's interest rate. Leverage multiplies the spread. Markers are days the worker changed the position on chain."
          : "TVL is the vault's total value on Voltr at the end of each UTC day; the last point is now. Total exposure is the collateral behind it: NAV plus what the vault has borrowed on Kamino."}
      </p>
    </div>
  );
}
