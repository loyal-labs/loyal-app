"use client";

import { useState } from "react";
import { CartesianGrid, Label, Line, LineChart, XAxis, YAxis } from "recharts";

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

import type { RebalanceActivityPoint } from "./rebalance-data";
import { RouteModeSwitch } from "./route-mode-switch";

type SerializedRebalanceActivityPoint = Omit<
  RebalanceActivityPoint,
  "maxSwapFeeLamports" | "swapFeeLamports"
> & {
  maxSwapFeeLamports: string;
  swapFeeLamports: string;
};

const chartConfig = {
  confirmed: {
    color: "var(--chart-2)",
    label: "Confirmed",
  },
  expiredSubmissions: {
    color: "var(--muted-foreground)",
    label: "Expired submissions",
  },
  failedDecisions: {
    color: "var(--chart-5)",
    label: "Failed decisions",
  },
  failedOpportunities: {
    color: "var(--chart-4)",
    label: "Failed opportunities",
  },
  fleetClaims: {
    color: "var(--chart-3)",
    label: "Fleet claims",
  },
  terminalAttempts: {
    color: "var(--chart-1)",
    label: "Terminal attempts",
  },
} satisfies ChartConfig;

const activitySeries = [
  { key: "confirmed", yAxisId: "events" },
  { key: "terminalAttempts", yAxisId: "events" },
  { key: "fleetClaims", yAxisId: "claims" },
  { key: "failedDecisions", yAxisId: "events" },
  { key: "failedOpportunities", yAxisId: "events" },
  { key: "expiredSubmissions", yAxisId: "events" },
] as const;

const swapFeeChartConfig = {
  maxSwapFeeSol: {
    color: "var(--chart-5)",
    label: "Largest swap fee",
  },
  swapFeeSol: {
    color: "var(--chart-2)",
    label: "Total swap fees",
  },
} satisfies ChartConfig;

function formatSol(value: bigint) {
  return `${(Number(value) / 1_000_000_000).toFixed(6)} SOL`;
}

function formatTickDate(value: unknown) {
  if (typeof value !== "string") {
    return String(value ?? "");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatTooltipDate(value: unknown) {
  if (typeof value !== "string") {
    return String(value ?? "");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function ActivityTimeSeries({
  data,
}: {
  data: SerializedRebalanceActivityPoint[];
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs">
        <span className="font-medium text-muted-foreground">Activity</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          {activitySeries.map(({ key }) => (
            <span className="flex items-center gap-1.5" key={key}>
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: chartConfig[key].color }}
              />
              {chartConfig[key].label}
            </span>
          ))}
        </div>
      </div>
      <ChartContainer
        className="aspect-auto h-[260px] w-full min-w-0 sm:h-[300px]"
        config={chartConfig}
      >
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ bottom: 20, left: 4, right: 4, top: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="bucketStartedAt"
            minTickGap={36}
            tickFormatter={formatTickDate}
            tickLine={false}
            tickMargin={8}
          >
            <Label offset={-14} position="insideBottom" value="Time (UTC)" />
          </XAxis>
          <YAxis
            allowDecimals={false}
            axisLine={false}
            domain={[0, (maximum: number) => Math.max(1, maximum)]}
            tickLine={false}
            width={40}
            yAxisId="events"
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            domain={[0, (maximum: number) => Math.max(1, maximum)]}
            orientation="right"
            tickLine={false}
            width={48}
            yAxisId="claims"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-[190px]"
                labelFormatter={formatTooltipDate}
              />
            }
          />
          {activitySeries.map(({ key, yAxisId }) => (
            <Line
              dataKey={key}
              dot={false}
              key={key}
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              type="linear"
              yAxisId={yAxisId}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function SwapFeeTimeSeries({
  data,
}: {
  data: SerializedRebalanceActivityPoint[];
}) {
  const feeData = data.map((point) => ({
    ...point,
    maxSwapFeeSol: Number(BigInt(point.maxSwapFeeLamports)) / 1_000_000_000,
    swapFeeSol: Number(BigInt(point.swapFeeLamports)) / 1_000_000_000,
  }));

  return (
    <div className="min-w-0 space-y-2 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs">
        <span className="font-medium text-muted-foreground">
          Finalized swap fees
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          {Object.entries(swapFeeChartConfig).map(([key, config]) => (
            <span className="flex items-center gap-1.5" key={key}>
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: config.color }}
              />
              {config.label}
            </span>
          ))}
        </div>
      </div>
      <ChartContainer
        className="aspect-auto h-[220px] w-full min-w-0"
        config={swapFeeChartConfig}
      >
        <LineChart
          accessibilityLayer
          data={feeData}
          margin={{ bottom: 20, left: 8, right: 12, top: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="bucketStartedAt"
            minTickGap={36}
            tickFormatter={formatTickDate}
            tickLine={false}
            tickMargin={8}
          >
            <Label offset={-14} position="insideBottom" value="Time (UTC)" />
          </XAxis>
          <YAxis
            allowDecimals
            axisLine={false}
            domain={[0, (maximum: number) => Math.max(0.000001, maximum)]}
            tickFormatter={(value: number) => value.toFixed(6)}
            tickLine={false}
            width={68}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-[190px]"
                labelFormatter={formatTooltipDate}
              />
            }
          />
          <Line
            dataKey="swapFeeSol"
            dot={false}
            stroke="var(--color-swapFeeSol)"
            strokeWidth={2}
            type="linear"
          />
          <Line
            dataKey="maxSwapFeeSol"
            dot={false}
            stroke="var(--color-maxSwapFeeSol)"
            strokeWidth={2}
            type="linear"
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

export function RebalanceActivityChart({
  data,
}: {
  data: SerializedRebalanceActivityPoint[];
}) {
  const [routeMode, setRouteMode] =
    useState<RebalanceActivityPoint["routeMode"]>("same_mint");
  const visibleData = data.filter((point) => point.routeMode === routeMode);
  const totals = visibleData.reduce(
    (result, point) => ({
      confirmed: result.confirmed + point.confirmed,
      finalizedSwapLegs: result.finalizedSwapLegs + point.finalizedSwapLegs,
      failures:
        result.failures +
        point.failedDecisions +
        point.failedOpportunities +
        point.expiredSubmissions,
      maxSwapFeeLamports:
        BigInt(point.maxSwapFeeLamports) > result.maxSwapFeeLamports
          ? BigInt(point.maxSwapFeeLamports)
          : result.maxSwapFeeLamports,
      swapFeeLamports: result.swapFeeLamports + BigInt(point.swapFeeLamports),
    }),
    {
      confirmed: 0,
      finalizedSwapLegs: 0,
      failures: 0,
      maxSwapFeeLamports: BigInt(0),
      swapFeeLamports: BigInt(0),
    }
  );
  const averageSwapFeeLamports =
    totals.finalizedSwapLegs > 0
      ? totals.swapFeeLamports / BigInt(totals.finalizedSwapLegs)
      : BigInt(0);

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Rebalance activity</CardTitle>
          <CardDescription>
            Last 72 hours of{" "}
            {routeMode === "cross_mint" ? "Crossmint" : "same-mint"} activity in
            two-hour UTC buckets from Yield Neon. Fleet claims use the right
            axis; all other activity series use the left axis. Render-only
            errors are not included.
          </CardDescription>
          <RouteModeSwitch
            id="rebalance-activity-route-mode"
            mode={routeMode}
            onModeChange={setRouteMode}
          />
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Confirmed</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totals.confirmed.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">
              Failure records
            </span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totals.failures.toLocaleString()}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-6 sm:p-6">
        {routeMode === "cross_mint" ? (
          <div className="mb-5 grid gap-3 px-2 text-xs text-muted-foreground sm:grid-cols-3">
            <span>
              Swap fees{" "}
              <strong className="text-foreground">
                {formatSol(totals.swapFeeLamports)}
              </strong>
            </span>
            <span>
              Average{" "}
              <strong className="text-foreground">
                {formatSol(averageSwapFeeLamports)}
              </strong>
            </span>
            <span>
              Largest{" "}
              <strong className="text-foreground">
                {formatSol(totals.maxSwapFeeLamports)}
              </strong>
            </span>
          </div>
        ) : null}
        <ActivityTimeSeries data={visibleData} />
        {routeMode === "cross_mint" ? (
          <SwapFeeTimeSeries data={visibleData} />
        ) : null}
      </CardContent>
    </Card>
  );
}
