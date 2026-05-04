"use client";

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
import type { SmartAccountSpendPoint } from "./smart-accounts-data";

type SmartAccountSponsorshipSpendChartProps = {
  data: SmartAccountSpendPoint[];
  solPriceUsd: number | null;
  totalSpentSol30d: number;
  totalSpentUsd30d: number | null;
};

function formatTickDate(value: unknown) {
  if (typeof value !== "string") return String(value ?? "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function formatTooltipDate(value: unknown) {
  if (typeof value !== "string") return String(value ?? "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatUsd(value: number) {
  return value.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

export function SmartAccountSponsorshipSpendChart({
  data,
  solPriceUsd,
  totalSpentSol30d,
  totalSpentUsd30d,
}: SmartAccountSponsorshipSpendChartProps) {
  const usesUsd = solPriceUsd !== null;
  const chartData = data.map((point) => ({
    date: point.date,
    spend: usesUsd ? point.usd ?? 0 : point.amount,
  }));
  const chartConfig: ChartConfig = {
    spend: {
      label: usesUsd ? "USD spent" : "SOL spent",
      color: "var(--foreground)",
    },
  };

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Account sponsorship spend</CardTitle>
          <CardDescription>
            Sponsor wallet spend on smart account creation (30 days)
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">30d spent</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totalSpentSol30d.toLocaleString()} SOL
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">
              {usesUsd ? "USD estimate" : "USD"}
            </span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totalSpentUsd30d === null ? "N/A" : formatUsd(totalSpentUsd30d)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full min-w-0"
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{ bottom: 24, left: 16, right: 16, top: 8 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={32}
              tickFormatter={formatTickDate}
              tickLine={false}
              tickMargin={8}
            >
              <Label value="Date (UTC)" position="insideBottom" offset={-16} />
            </XAxis>
            <YAxis axisLine={false} tickLine={false} width={52}>
              <Label
                angle={-90}
                position="insideLeft"
                style={{ textAnchor: "middle" }}
                value={usesUsd ? "USD" : "SOL"}
              />
            </YAxis>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[150px]"
                  labelFormatter={formatTooltipDate}
                />
              }
            />
            <Bar dataKey="spend" fill="var(--color-spend)" radius={2} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
