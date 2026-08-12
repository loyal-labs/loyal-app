"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  Line,
  LineChart,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { AutodepositTimeSeriesRangeKey } from "../earn/rebalance/rebalance-data";

export type SerializedAutodepositTimeSeriesPoint = {
  bucketStartedAt: string;
  depositedAmountRaw: string;
  successful: number;
};

export type SerializedAutodepositTimeSeriesRange = {
  bucketHours: number;
  key: AutodepositTimeSeriesRangeKey;
  points: SerializedAutodepositTimeSeriesPoint[];
};

type ChartPoint = SerializedAutodepositTimeSeriesPoint & {
  depositedUsdc: number;
};

const rangeLabels: Record<
  AutodepositTimeSeriesRangeKey,
  { bucket: string; label: string }
> = {
  "2d": { bucket: "2-hour", label: "2 days" },
  "7d": { bucket: "6-hour", label: "7 days" },
  "30d": { bucket: "daily", label: "30 days" },
};

const successConfig = {
  successful: {
    color: "var(--foreground)",
    label: "Successful autodeposits",
  },
} satisfies ChartConfig;

const volumeConfig = {
  depositedUsdc: {
    color: "var(--foreground)",
    label: "Deposited USDC",
  },
} satisfies ChartConfig;

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

function formatUsdc(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)} USDC`;
}

function formatTickDate(
  value: unknown,
  rangeKey: AutodepositTimeSeriesRangeKey
) {
  if (typeof value !== "string") {
    return String(value ?? "");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: rangeKey === "30d" ? undefined : "2-digit",
    hour12: false,
    month: "short",
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
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

function MetricLegend({ label, total }: { label: string; total: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{total}</span>
    </div>
  );
}

function SuccessChart({
  data,
  rangeKey,
  total,
}: {
  data: ChartPoint[];
  rangeKey: AutodepositTimeSeriesRangeKey;
  total: number;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <MetricLegend
        label="Successful autodeposits"
        total={`${total.toLocaleString("en-US")} total`}
      />
      <ChartContainer
        className="aspect-auto h-[190px] w-full min-w-0"
        config={successConfig}
      >
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ bottom: 22, left: 4, right: 16, top: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="bucketStartedAt"
            minTickGap={rangeKey === "30d" ? 36 : 44}
            tickFormatter={(value) => formatTickDate(value, rangeKey)}
            tickLine={false}
            tickMargin={8}
          >
            <Label
              offset={-16}
              position="insideBottom"
              value="Time (your local time)"
            />
          </XAxis>
          <YAxis
            allowDecimals={false}
            axisLine={false}
            domain={[0, (maximum: number) => Math.max(1, maximum)]}
            tickFormatter={formatCompact}
            tickLine={false}
            width={42}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-[210px]"
                labelFormatter={formatTooltipDate}
              />
            }
          />
          <Line
            dataKey="successful"
            dot={false}
            stroke="var(--color-successful)"
            strokeWidth={2}
            type="linear"
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function VolumeChart({
  data,
  rangeKey,
  total,
}: {
  data: ChartPoint[];
  rangeKey: AutodepositTimeSeriesRangeKey;
  total: number;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <MetricLegend
        label="Autodeposit deposited volume"
        total={formatUsdc(total)}
      />
      <ChartContainer
        className="aspect-auto h-[190px] w-full min-w-0"
        config={volumeConfig}
      >
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ bottom: 22, left: 4, right: 16, top: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="bucketStartedAt"
            minTickGap={rangeKey === "30d" ? 36 : 44}
            tickFormatter={(value) => formatTickDate(value, rangeKey)}
            tickLine={false}
            tickMargin={8}
          >
            <Label
              offset={-16}
              position="insideBottom"
              value="Time (your local time)"
            />
          </XAxis>
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickFormatter={formatCompact}
            tickLine={false}
            width={48}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-[210px]"
                labelFormatter={formatTooltipDate}
              />
            }
          />
          <Bar
            dataKey="depositedUsdc"
            fill="var(--color-depositedUsdc)"
            maxBarSize={36}
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export function AutodepositActivityChart({
  data,
}: {
  data: SerializedAutodepositTimeSeriesRange[];
}) {
  const [rangeKey, setRangeKey] = useState<AutodepositTimeSeriesRangeKey>("2d");
  const selectedRange = data.find((range) => range.key === rangeKey) ?? data[0];
  const chartData = useMemo<ChartPoint[]>(
    () =>
      (selectedRange?.points ?? []).map((point) => ({
        ...point,
        depositedUsdc: Number(point.depositedAmountRaw) / 1_000_000,
      })),
    [selectedRange]
  );
  const totals = useMemo(
    () =>
      chartData.reduce(
        (result, point) => ({
          depositedUsdc: result.depositedUsdc + point.depositedUsdc,
          successful: result.successful + point.successful,
        }),
        { depositedUsdc: 0, successful: 0 }
      ),
    [chartData]
  );
  const rangeLabel = selectedRange
    ? `${rangeLabels[selectedRange.key].label} in ${
        rangeLabels[selectedRange.key].bucket
      } buckets`
    : "No range available";

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 xl:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Autodeposit activity</CardTitle>
          <CardDescription>
            {rangeLabel}, bucketed on UTC boundaries and shown in your local
            time. Successful means a persisted executed pull without a
            completion failure; volume is the successfully pulled amount. The
            latest bucket is partial.
          </CardDescription>
          <Tabs
            className="mt-3"
            onValueChange={(value) =>
              setRangeKey(value as AutodepositTimeSeriesRangeKey)
            }
            value={rangeKey}
          >
            <TabsList>
              <TabsTrigger value="2d">2 days · 2h</TabsTrigger>
              <TabsTrigger value="7d">7 days · 6h</TabsTrigger>
              <TabsTrigger value="30d">30 days · 1d</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="grid grid-cols-2 xl:min-w-[320px]">
          <div className="flex flex-col justify-center gap-1 border-t px-4 py-4 text-left xl:border-t-0 xl:border-l xl:px-6 xl:py-6">
            <span className="text-xs text-muted-foreground">Successful</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-2xl">
              {totals.successful.toLocaleString("en-US")}
            </span>
          </div>
          <div className="flex flex-col justify-center gap-1 border-t border-l px-4 py-4 text-left xl:border-t-0 xl:px-6 xl:py-6">
            <span className="text-xs text-muted-foreground">Deposited</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-2xl">
              {formatCompact(totals.depositedUsdc)}
            </span>
            <span className="text-xs text-muted-foreground">USDC</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-6 sm:p-6">
        {chartData.length > 0 ? (
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <SuccessChart
              data={chartData}
              rangeKey={rangeKey}
              total={totals.successful}
            />
            <VolumeChart
              data={chartData}
              rangeKey={rangeKey}
              total={totals.depositedUsdc}
            />
          </div>
        ) : (
          <p className="px-2 text-sm text-muted-foreground">
            No autodeposit activity found for this range.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
