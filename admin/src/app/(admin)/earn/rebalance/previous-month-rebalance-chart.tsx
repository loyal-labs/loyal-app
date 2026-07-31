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

import type { PreviousMonthRebalancePoint } from "./rebalance-data";

const chartConfig = {
  confirmed: {
    color: "var(--foreground)",
    label: "Successful rebalances",
  },
  failed: {
    color: "var(--destructive)",
    label: "Failed attempts",
  },
} satisfies ChartConfig;

function parseDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTickDate(value: unknown) {
  const date = parseDate(value);
  if (!date) {
    return String(value ?? "");
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatTooltipDate(value: unknown) {
  const date = parseDate(value);
  if (!date) {
    return String(value ?? "");
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function formatMonth(value: string | undefined) {
  const date = parseDate(value);
  if (!date) {
    return "previous calendar month";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function PreviousMonthRebalanceChart({
  data,
}: {
  data: PreviousMonthRebalancePoint[];
}) {
  const totals = data.reduce(
    (result, point) => ({
      confirmed: result.confirmed + point.confirmed,
      failed: result.failed + point.failed,
    }),
    { confirmed: 0, failed: 0 }
  );
  const monthLabel = formatMonth(data[0]?.date);

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">
            Previous-month rebalance outcomes
          </CardTitle>
          <CardDescription>
            Daily terminal same-mint decisions for {monthLabel}, using
            Asia/Yekaterinburg calendar boundaries. Render-only errors are not
            included.
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Successful</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totals.confirmed.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Failed</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totals.failed.toLocaleString()}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-6 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground">
          {Object.entries(chartConfig).map(([key, config]) => (
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
        <ChartContainer
          className="aspect-auto h-[300px] w-full min-w-0"
          config={chartConfig}
        >
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ bottom: 24, left: 8, right: 16, top: 8 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={36}
              tickFormatter={formatTickDate}
              tickLine={false}
              tickMargin={8}
            >
              <Label
                offset={-16}
                position="insideBottom"
                value="Date (Asia/Yekaterinburg)"
              />
            </XAxis>
            <YAxis
              allowDecimals={false}
              axisLine={false}
              domain={[0, (maximum: number) => Math.max(1, maximum)]}
              tickLine={false}
              width={44}
            >
              <Label
                angle={-90}
                position="insideLeft"
                style={{ textAnchor: "middle" }}
                value="Terminal attempts"
              />
            </YAxis>
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
            <Line
              dataKey="failed"
              dot={false}
              stroke="var(--color-failed)"
              strokeWidth={2}
              type="linear"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
