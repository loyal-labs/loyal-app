"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Label, XAxis, YAxis } from "recharts";

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

import type { AutodepositTimeSeriesRangeKey } from "./rebalance-data";

export type SerializedAutodepositFailurePoint = {
  accountNotFound: number;
  bucketStartedAt: string;
  confirmationOrTimeout: number;
  insufficientRent: number;
  missingTokenDelegate: number;
  noLinkedError: number;
  otherPrePull: number;
  postPullKaminoTopUp: number;
};

export type SerializedAutodepositFailureRange = {
  bucketHours: number;
  key: AutodepositTimeSeriesRangeKey;
  points: SerializedAutodepositFailurePoint[];
};

const rangeLabels: Record<
  AutodepositTimeSeriesRangeKey,
  { bucket: string; label: string }
> = {
  "2d": { bucket: "2-hour", label: "2 days" },
  "7d": { bucket: "6-hour", label: "7 days" },
  "30d": { bucket: "daily", label: "30 days" },
};

const failureConfig = {
  accountNotFound: {
    color: "var(--chart-1)",
    label: "AccountNotFound",
  },
  otherPrePull: {
    color: "var(--chart-2)",
    label: "Other pre-pull",
  },
  insufficientRent: {
    color: "var(--chart-3)",
    label: "Insufficient rent",
  },
  missingTokenDelegate: {
    color: "var(--chart-4)",
    label: "Missing token delegate",
  },
  confirmationOrTimeout: {
    color: "var(--chart-5)",
    label: "Confirmation / timeout",
  },
  noLinkedError: {
    color: "var(--muted-foreground)",
    label: "No linked error",
  },
  postPullKaminoTopUp: {
    color: "var(--destructive)",
    label: "Post-pull Kamino top-up",
  },
} satisfies ChartConfig;

type FailureSeriesKey = keyof typeof failureConfig;

const failureSeries = Object.keys(failureConfig) as FailureSeriesKey[];

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
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

export function AutodepositFailuresChart({
  data,
}: {
  data: SerializedAutodepositFailureRange[];
}) {
  const [rangeKey, setRangeKey] = useState<AutodepositTimeSeriesRangeKey>("2d");
  const selectedRange = data.find((range) => range.key === rangeKey) ?? data[0];
  const chartData = useMemo(() => selectedRange?.points ?? [], [selectedRange]);
  const totals = useMemo(() => {
    const initialTotals = Object.fromEntries(
      failureSeries.map((key) => [key, 0])
    ) as Record<FailureSeriesKey, number>;

    return chartData.reduce((result, point) => {
      for (const key of failureSeries) {
        result[key] += point[key];
      }
      return result;
    }, initialTotals);
  }, [chartData]);
  const total = failureSeries.reduce((sum, key) => sum + totals[key], 0);
  const rangeLabel = selectedRange
    ? `${rangeLabels[selectedRange.key].label} in ${
        rangeLabels[selectedRange.key].bucket
      } buckets`
    : "No range available";

  return (
    <Card className="w-full gap-0 py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 xl:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Failed attempts by cause</CardTitle>
          <CardDescription>
            {rangeLabel}, bucketed on UTC boundaries and shown in your local
            time. Failures are retry attempts, not unique wallets. The latest
            bucket is partial.
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
        <div className="flex min-w-[180px] flex-col justify-center gap-1 border-t px-6 py-4 text-left xl:border-t-0 xl:border-l xl:py-6">
          <span className="text-xs text-muted-foreground">Failed attempts</span>
          <span className="text-lg leading-none font-bold tabular-nums sm:text-2xl">
            {total.toLocaleString("en-US")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-4 sm:p-6">
        {chartData.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground">
              {failureSeries.map((key) => (
                <span className="flex items-center gap-1.5" key={key}>
                  <span
                    aria-hidden
                    className="size-2.5 rounded-[2px]"
                    style={{ backgroundColor: failureConfig[key].color }}
                  />
                  {failureConfig[key].label} (
                  {totals[key].toLocaleString("en-US")})
                </span>
              ))}
            </div>
            <ChartContainer
              className="aspect-auto h-[260px] w-full min-w-0"
              config={failureConfig}
            >
              <BarChart
                accessibilityLayer
                data={chartData}
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
                      className="min-w-[230px]"
                      labelFormatter={formatTooltipDate}
                    />
                  }
                />
                {failureSeries.map((key) => (
                  <Bar
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    key={key}
                    maxBarSize={36}
                    stackId="failures"
                  />
                ))}
              </BarChart>
            </ChartContainer>
          </>
        ) : (
          <p className="px-2 text-sm text-muted-foreground">
            No autodeposit failures found for this range.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
