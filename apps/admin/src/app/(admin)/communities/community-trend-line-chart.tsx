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

type CommunityTrendLineChartProps<TDataKey extends string> = {
  title: string;
  description: string;
  primaryLabel: string;
  secondaryLabel: string;
  dataKey: TDataKey;
  data: Array<
    {
      date: string;
    } & Record<TDataKey, number>
  >;
  totals: {
    primary: number;
    secondary: number;
  };
  yAxisLabel: string;
};

function formatTickDate(value: unknown) {
  if (typeof value !== "string") return String(value ?? "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatTooltipDate(value: unknown) {
  if (typeof value !== "string") return String(value ?? "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CommunityTrendLineChart<TDataKey extends string>({
  title,
  description,
  primaryLabel,
  secondaryLabel,
  dataKey,
  data,
  totals,
  yAxisLabel,
}: CommunityTrendLineChartProps<TDataKey>) {
  const chartConfig: ChartConfig = {
    [dataKey]: {
      label: primaryLabel,
      color: "var(--foreground)",
    },
    secondary: {
      label: secondaryLabel,
      color: "var(--muted-foreground)",
    },
  };

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">
              {primaryLabel}
            </span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totals.primary.toLocaleString("en-US")}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">
              {secondaryLabel}
            </span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totals.secondary.toLocaleString("en-US")}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full min-w-0"
        >
          <LineChart
            accessibilityLayer
            data={data}
            margin={{
              left: 16,
              right: 16,
              top: 8,
              bottom: 24,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatTickDate}
            >
              <Label value="Date (UTC)" position="insideBottom" offset={-16} />
            </XAxis>
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={44}
            >
              <Label
                value={yAxisLabel}
                angle={-90}
                position="insideLeft"
                style={{ textAnchor: "middle" }}
              />
            </YAxis>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  nameKey={dataKey}
                  labelFormatter={formatTooltipDate}
                />
              }
            />
            <Line
              dataKey={dataKey}
              type="monotone"
              stroke={`var(--color-${dataKey})`}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
