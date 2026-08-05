"use client";

import { useMemo } from "react";
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

import type { MetricPoint, MetricsDashboardData } from "./metrics-data";

const SERIES_COLORS = [
  "hsl(221 83% 53%)",
  "hsl(142 71% 45%)",
  "hsl(25 95% 53%)",
  "hsl(262 83% 58%)",
  "hsl(346 77% 50%)",
  "hsl(188 86% 43%)",
  "hsl(45 93% 47%)",
  "hsl(215 16% 47%)",
];

type Surface = "desktop" | "mobile";

type OperationChart = {
  config: ChartConfig;
  data: Array<Record<string, number | string>>;
  operation: string;
  series: Array<{ key: string; label: string }>;
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll(".", " · ");
}

function formatTickDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return String(value ?? "");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    month: "short",
  }).format(date);
}

function formatTooltipDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return String(value ?? "");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
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

function seriesLabel(point: MetricPoint, surface: Surface): string {
  if (surface === "mobile") {
    return `${humanize(point.platform)} · ${humanize(point.outcome)}`;
  }

  const phase = point.phase ? humanize(point.phase) : "total";
  const dependency = point.dependency ? ` · ${humanize(point.dependency)}` : "";
  return `${phase}${dependency} · ${humanize(point.outcome)}`;
}

function getLatestSampleAt(data: MetricsDashboardData): string | null {
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const points of [data.desktop, data.mobile]) {
    for (const point of points) {
      latestTime = Math.max(latestTime, Date.parse(point.bucketStartedAt));
    }
  }

  return Number.isFinite(latestTime)
    ? new Date(latestTime).toISOString()
    : null;
}

function buildOperationCharts(
  points: MetricPoint[],
  surface: Surface
): OperationChart[] {
  const byOperation = new Map<string, MetricPoint[]>();
  for (const point of points) {
    const operationPoints = byOperation.get(point.operation) ?? [];
    operationPoints.push(point);
    byOperation.set(point.operation, operationPoints);
  }

  return [...byOperation.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([operation, operationPoints]) => {
      const labels = [
        ...new Set(operationPoints.map((point) => seriesLabel(point, surface))),
      ].sort();
      const series = labels.map((label, index) => ({
        key: `series${index}`,
        label,
      }));
      const keyByLabel = new Map(series.map((item) => [item.label, item.key]));
      const config = Object.fromEntries(
        series.map((item, index) => [
          item.key,
          {
            color: SERIES_COLORS[index % SERIES_COLORS.length],
            label: item.label,
          },
        ])
      ) satisfies ChartConfig;
      const rowsByBucket = new Map<string, Record<string, number | string>>();

      for (const point of operationPoints) {
        const row = rowsByBucket.get(point.bucketStartedAt) ?? {
          bucketTime: Date.parse(point.bucketStartedAt),
        };
        const seriesKey = keyByLabel.get(seriesLabel(point, surface));
        if (seriesKey) {
          row[seriesKey] = Math.round((point.p95Ms / 1_000) * 100) / 100;
        }
        rowsByBucket.set(point.bucketStartedAt, row);
      }

      return {
        config,
        data: [...rowsByBucket.values()].sort(
          (left, right) => Number(left.bucketTime) - Number(right.bucketTime)
        ),
        operation,
        series,
      };
    });
}

function MetricChartCard({ chart }: { chart: OperationChart }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="capitalize">
          {humanize(chart.operation)}
        </CardTitle>
        <CardDescription>
          {chart.series.length} series · p95 seconds
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {chart.series.map((item) => (
            <div key={item.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-[2px]"
                style={{ backgroundColor: chart.config[item.key]?.color }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <ChartContainer
          className="aspect-auto h-[260px] w-full min-w-0"
          config={chart.config}
        >
          <LineChart
            accessibilityLayer
            data={chart.data}
            margin={{ bottom: 22, left: 4, right: 16, top: 8 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="bucketTime"
              domain={["dataMin", "dataMax"]}
              minTickGap={42}
              scale="time"
              tickFormatter={formatTickDate}
              tickLine={false}
              tickMargin={8}
              type="number"
            >
              <Label
                offset={-16}
                position="insideBottom"
                value="Time (your local time)"
              />
            </XAxis>
            <YAxis
              axisLine={false}
              domain={[0, "auto"]}
              tickFormatter={(value: number) => `${value}s`}
              tickLine={false}
              width={48}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="min-w-[220px]"
                  labelFormatter={formatTooltipDate}
                />
              }
            />
            {chart.series.map((item) => (
              <Line
                key={item.key}
                connectNulls={false}
                dataKey={item.key}
                dot={{ r: 1.5, strokeWidth: 0 }}
                stroke={`var(--color-${item.key})`}
                strokeWidth={2}
                type="linear"
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function SurfaceSection({
  points,
  status,
  surface,
}: {
  points: MetricPoint[];
  status: "available" | "unavailable";
  surface: Surface;
}) {
  const charts = useMemo(
    () => buildOperationCharts(points, surface),
    [points, surface]
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold capitalize">{surface}</h2>
        <p className="text-sm text-muted-foreground">
          {surface === "desktop"
            ? "Web app loading and Earn interaction latency."
            : "iOS and Android app loading and Earn operation latency."}
        </p>
      </div>
      {status === "unavailable" ? (
        <Card>
          <CardHeader>
            <CardTitle>Metrics unavailable</CardTitle>
            <CardDescription>
              ClickStack could not be queried. Check the server-side admin
              configuration.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : charts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No recent metrics</CardTitle>
            <CardDescription>
              No production measurements arrived during this 7-day window.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {charts.map((chart) => (
            <MetricChartCard key={chart.operation} chart={chart} />
          ))}
        </div>
      )}
    </section>
  );
}

export function MetricsDashboard({ data }: { data: MetricsDashboardData }) {
  const latestSampleAt = getLatestSampleAt(data);

  return (
    <div className="space-y-10">
      <p className="text-xs text-muted-foreground">
        Queried {formatTooltipDate(data.fetchedAt)}
        {latestSampleAt
          ? ` · latest sample ${formatTooltipDate(latestSampleAt)}`
          : ""}
        {
          " · values are milliseconds in ClickStack and displayed here in seconds."
        }
      </p>
      <SurfaceSection
        points={data.desktop}
        status={data.status.desktop}
        surface="desktop"
      />
      <SurfaceSection
        points={data.mobile}
        status={data.status.mobile}
        surface="mobile"
      />
    </div>
  );
}
