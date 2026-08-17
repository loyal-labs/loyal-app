"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  RebalanceOpportunitySummary,
  RebalancePerformancePoint,
  RebalancePerformanceSummary,
} from "@/lib/earn/rebalance-performance.shared";

const chartConfig = {
  bestObservedApyPercent: {
    color: "var(--muted-foreground)",
    label: "Best observed Safe APY",
  },
  confirmedRebalanceApyPercent: {
    color: "var(--foreground)",
    label: "Confirmed rebalance",
  },
  fleetWeightedApyPercent: {
    color: "var(--foreground)",
    label: "Fleet-weighted APY",
  },
} satisfies ChartConfig;

type SourceStatus = "available" | "unavailable";

function formatPercent(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value)
    ? "Unavailable"
    : `${value.toFixed(digits)}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function SummaryMetric({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

export function EarnRebalancePerformanceChart({
  opportunities,
  points,
  sources,
  summary,
  symbol,
}: {
  opportunities: RebalanceOpportunitySummary | null;
  points: RebalancePerformancePoint[];
  sources: { fleet: SourceStatus; market: SourceStatus };
  summary: RebalancePerformanceSummary;
  symbol: string;
}) {
  const chartPoints = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        confirmedRebalanceApyPercent:
          point.confirmedRebalanceCount > 0
            ? point.fleetWeightedApyPercent ?? point.bestObservedApyPercent
            : null,
      })),
    [points]
  );
  const hasChartData = chartPoints.some(
    (point) =>
      point.bestObservedApyPercent !== null ||
      point.fleetWeightedApyPercent !== null
  );
  const sourceNote =
    sources.market === "available" && sources.fleet === "available"
      ? `${formatPercent(
          summary.coveragePercent
        )} of fleet AUM-time has matching market observations.`
      : `Partial data: market ${sources.market}, fleet ${sources.fleet}.`;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="font-bold">
          {symbol} rebalance performance
        </CardTitle>
        <CardDescription>
          Best observed Safe APY compared with the AUM-weighted fleet APY over
          the last seven days. Historical observations are not a claim of
          point-in-time eligibility.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric
            label="AUM-time in best reserve"
            note={sourceNote}
            value={formatPercent(summary.aumTimeInBestReservePercent)}
          />
          <SummaryMetric
            label="Confirmed opportunities"
            note="Distinct qualified opportunities in this window."
            value={
              opportunities
                ? `${opportunities.confirmed} / ${opportunities.qualified}`
                : "Unavailable"
            }
          />
          <SummaryMetric
            label="Failed opportunities"
            note="Distinct terminal outcomes."
            value={opportunities ? String(opportunities.failed) : "Unavailable"}
          />
          <SummaryMetric
            label="Pending opportunities"
            note="Qualified opportunities without a terminal outcome."
            value={
              opportunities ? String(opportunities.pending) : "Unavailable"
            }
          />
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-6 bg-foreground" aria-hidden />
            Fleet-weighted APY
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-0.5 w-6 border-t border-dashed border-muted-foreground"
              aria-hidden
            />
            Best observed Safe APY
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full bg-foreground"
              aria-hidden
            />
            Confirmed rebalance
          </span>
        </div>

        {hasChartData ? (
          <ChartContainer
            className="h-[22rem] w-full min-w-0"
            config={chartConfig}
          >
            <ComposedChart accessibilityLayer data={chartPoints}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="bucketStartedAt"
                minTickGap={40}
                tickFormatter={formatDateTime}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={["auto", "auto"]}
                tickFormatter={(value: number) => `${value.toFixed(1)}%`}
                tickLine={false}
                width={54}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => formatDateTime(String(value))}
                  />
                }
              />
              <Line
                connectNulls={false}
                dataKey="bestObservedApyPercent"
                dot={false}
                isAnimationActive={false}
                stroke="var(--color-bestObservedApyPercent)"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                type="monotone"
              />
              <Line
                connectNulls={false}
                dataKey="fleetWeightedApyPercent"
                dot={false}
                isAnimationActive={false}
                stroke="var(--color-fleetWeightedApyPercent)"
                strokeWidth={2}
                type="monotone"
              />
              <Scatter
                dataKey="confirmedRebalanceApyPercent"
                fill="var(--color-confirmedRebalanceApyPercent)"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No matching fleet and market observations are available for this
            stablecoin and window.
          </div>
        )}

        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Accessible performance data
          </summary>
          <div className="mt-3 max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Observed at</TableHead>
                  <TableHead className="text-right">
                    Best observed APY
                  </TableHead>
                  <TableHead className="text-right">Fleet APY</TableHead>
                  <TableHead className="text-right">Fleet in best</TableHead>
                  <TableHead className="text-right">Confirmed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chartPoints.map((point) => (
                  <TableRow key={point.bucketStartedAt}>
                    <TableCell>
                      {formatDateTime(point.bucketStartedAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(point.bestObservedApyPercent, 2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(point.fleetWeightedApyPercent, 2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(point.fleetShareInBestReservePercent)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {point.confirmedRebalanceCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
