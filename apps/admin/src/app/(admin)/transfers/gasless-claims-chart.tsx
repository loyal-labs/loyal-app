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
import type { GaslessClaimPoint } from "./transfers-data";

type GaslessClaimsChartProps = {
  data: GaslessClaimPoint[];
  totalSpent: number;
};

const chartConfig: ChartConfig = {
  amount: {
    label: "SOL spent",
    color: "var(--foreground)",
  },
};

function formatTickDate(value: unknown) {
  if (typeof value !== "string") return String(value ?? "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

export function GaslessClaimsChart({
  data,
  totalSpent,
}: GaslessClaimsChartProps) {
  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Gasless claims</CardTitle>
          <CardDescription>
            SOL spent on gasless claim transactions (30 days)
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Total spent</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totalSpent.toLocaleString()} SOL
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
            data={data}
            margin={{ left: 16, right: 16, top: 8, bottom: 24 }}
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
            <YAxis tickLine={false} axisLine={false} width={44}>
              <Label
                value="SOL"
                angle={-90}
                position="insideLeft"
                style={{ textAnchor: "middle" }}
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
            <Bar dataKey="amount" fill="var(--color-amount)" radius={2} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
