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
import type { SmartAccountCreationPoint } from "./smart-accounts-data";

type SmartAccountCreationsChartProps = {
  data: SmartAccountCreationPoint[];
  totalAccounts: number;
  totalCreated30d: number;
};

const chartConfig: ChartConfig = {
  count: {
    label: "Created",
    color: "var(--foreground)",
  },
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

export function SmartAccountCreationsChart({
  data,
  totalAccounts,
  totalCreated30d,
}: SmartAccountCreationsChartProps) {
  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-6">
          <CardTitle className="font-bold">Smart accounts created</CardTitle>
          <CardDescription>
            Daily ready smart accounts (30 days)
          </CardDescription>
        </div>
        <div className="flex">
          <div className="flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totalAccounts.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:px-8 sm:py-6">
            <span className="text-xs text-muted-foreground">30d</span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-3xl">
              {totalCreated30d.toLocaleString()}
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
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={44}
            >
              <Label
                angle={-90}
                position="insideLeft"
                style={{ textAnchor: "middle" }}
                value="Accounts"
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
            <Bar dataKey="count" fill="var(--color-count)" radius={2} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
