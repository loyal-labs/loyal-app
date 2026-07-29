"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
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
  type ChartConfig,
} from "@/components/ui/chart";

type SerializedOptimizationVolumePoint = {
  confirmedCount: number;
  cumulativeAmountRaw: string;
  dailyAmountRaw: string;
  date: string;
};

type VolumeTooltipPayload = {
  color?: string;
  dataKey?: string;
  name?: string;
  payload?: {
    confirmedCount?: number;
  };
  value?: number;
};

function rawToUsdc(value: string) {
  return Number(BigInt(value)) / 1_000_000;
}

function formatUsd(value: number, compact = false) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

function formatTickDate(value: unknown) {
  if (typeof value !== "string") {
    return String(value ?? "");
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatTooltipDate(value: unknown) {
  if (typeof value !== "string") {
    return String(value ?? "");
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function VolumeTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: unknown;
  payload?: VolumeTooltipPayload[];
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const confirmedCount = payload[0]?.payload?.confirmedCount ?? 0;

  return (
    <div className="grid min-w-[13rem] gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-foreground">
        {formatTooltipDate(label)}
      </div>
      <div className="grid gap-1">
        {payload.map((item) => (
          <div
            className="flex items-center justify-between gap-3"
            key={item.dataKey}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.name}</span>
            </div>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {formatUsd(item.value ?? 0)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t pt-1">
          <span className="text-muted-foreground">Confirmed moves</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {confirmedCount.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

export function OptimizationVolumeChart({
  data,
}: {
  data: SerializedOptimizationVolumePoint[];
}) {
  const chartData = data.map((point) => ({
    confirmedCount: point.confirmedCount,
    cumulativeVolume: rawToUsdc(point.cumulativeAmountRaw),
    dailyVolume: rawToUsdc(point.dailyAmountRaw),
    date: point.date,
  }));
  const latest = chartData.at(-1);
  const totalVolume = latest?.cumulativeVolume ?? 0;
  const todayVolume = latest?.dailyVolume ?? 0;
  const chartConfig = {
    cumulativeVolume: {
      color: "var(--foreground)",
      label: "Cumulative volume",
    },
    dailyVolume: {
      color: "var(--muted-foreground)",
      label: "Daily volume",
    },
  } satisfies ChartConfig;

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Optimization Volume</CardTitle>
          <CardDescription>
            Confirmed USDC moved by Earn optimizations. Bars show daily volume;
            the line is cumulative. The same capital counts again when a later
            optimization moves it.
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Cumulative</span>
            <span className="text-lg leading-none font-bold whitespace-nowrap tabular-nums sm:text-3xl">
              {formatUsd(totalVolume)}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Today</span>
            <span className="text-lg leading-none font-bold whitespace-nowrap tabular-nums sm:text-3xl">
              {formatUsd(todayVolume)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-6 sm:p-6">
        {chartData.length > 0 ? (
          <ChartContainer
            className="aspect-auto h-[300px] w-full min-w-0"
            config={chartConfig}
          >
            <ComposedChart
              accessibilityLayer
              data={chartData}
              margin={{ bottom: 24, left: 8, right: 8, top: 8 }}
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
                  value="Date (UTC)"
                />
              </XAxis>
              <YAxis
                axisLine={false}
                tickFormatter={(value) =>
                  typeof value === "number" ? formatUsd(value, true) : value
                }
                tickLine={false}
                width={68}
                yAxisId="daily"
              />
              <YAxis
                axisLine={false}
                orientation="right"
                tickFormatter={(value) =>
                  typeof value === "number" ? formatUsd(value, true) : value
                }
                tickLine={false}
                width={68}
                yAxisId="cumulative"
              />
              <ChartTooltip content={<VolumeTooltip />} />
              <Bar
                dataKey="dailyVolume"
                fill="var(--color-dailyVolume)"
                fillOpacity={0.42}
                name="Daily volume"
                radius={2}
                yAxisId="daily"
              />
              <Line
                dataKey="cumulativeVolume"
                dot={false}
                name="Cumulative volume"
                stroke="var(--color-cumulativeVolume)"
                strokeWidth={2}
                type="monotone"
                yAxisId="cumulative"
              />
            </ComposedChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            No confirmed optimization volume found.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
