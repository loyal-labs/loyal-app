"use client";

import { Bar, BarChart, CartesianGrid, Label, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type CommunityTopUsersBarChartProps = {
  data: Array<{
    userLabel: string;
    messageCount: number;
  }>;
};

function formatUserLabel(value: unknown) {
  const label = typeof value === "string" ? value : String(value ?? "");
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

export function CommunityTopUsersBarChart({ data }: CommunityTopUsersBarChartProps) {
  const chartConfig: ChartConfig = {
    messageCount: {
      label: "Messages",
      color: "var(--foreground)",
    },
  };
  const chartHeight = Math.max(320, data.length * 34);

  return (
    <Card className="w-full py-4 sm:py-0">
      <CardHeader className="border-b">
        <CardTitle className="font-bold">Top active users</CardTitle>
        <CardDescription>
          Top 20 users by messages sent in the last 30 days
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        {data.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center px-4 text-sm text-muted-foreground">
            No user activity in the last 30 days.
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto w-full min-w-0"
            style={{ height: `${chartHeight}px` }}
          >
            <BarChart
              accessibilityLayer
              data={data}
              layout="vertical"
              margin={{
                left: 16,
                right: 16,
                top: 8,
                bottom: 24,
              }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              >
                <Label value="Messages sent" position="insideBottom" offset={-16} />
              </XAxis>
              <YAxis
                dataKey="userLabel"
                type="category"
                tickLine={false}
                axisLine={false}
                width={132}
                interval={0}
                padding={{ top: 8, bottom: 8 }}
                tickFormatter={formatUserLabel}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="w-[220px]"
                    labelFormatter={(value) => String(value ?? "")}
                  />
                }
              />
              <Bar dataKey="messageCount" fill="var(--color-messageCount)" radius={2} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
