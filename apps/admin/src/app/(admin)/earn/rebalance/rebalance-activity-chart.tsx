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
            Last 72 hours in two-hour UTC buckets from Yield Neon. Fleet claims
            use the right axis; all other series use the left axis. Render-only
            errors are not included.
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
