"use client";

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

const chartConfig = {
  confirmed: {
    color: "var(--chart-2)",
    label: "Confirmed",
  },
} satisfies ChartConfig;

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

function ActivityTimeSeries({ data }: { data: RebalanceActivityPoint[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs">
        <span className="font-medium text-muted-foreground">
          Confirmed rebalances
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-3 rounded-full"
              style={{ backgroundColor: chartConfig.confirmed.color }}
            />
            {chartConfig.confirmed.label}
          </span>
        </div>
      </div>
      <ChartContainer
        className="aspect-auto h-[220px] w-full min-w-0 sm:h-[260px]"
        config={chartConfig}
      >
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ bottom: 20, left: 4, right: 16, top: 8 }}
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
            width={36}
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
            dataKey="confirmed"
            dot={false}
            stroke="var(--color-confirmed)"
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
  data: RebalanceActivityPoint[];
}) {
  const totals = data.reduce(
    (result, point) => ({
      confirmed: result.confirmed + point.confirmed,
      failures:
        result.failures +
        point.failedDecisions +
        point.failedOpportunities +
        point.expiredSubmissions,
    }),
    { confirmed: 0, failures: 0 }
  );

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Rebalance activity</CardTitle>
          <CardDescription>
            Confirmed executions from the last 72 hours in two-hour UTC buckets
            from Yield Neon. Render-only errors are not included.
          </CardDescription>
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
        <ActivityTimeSeries data={data} />
      </CardContent>
    </Card>
  );
}
