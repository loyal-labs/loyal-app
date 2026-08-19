"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
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
import type {
  SafeReserveApyMonitorData,
  SafeReserveRebalanceDecisionMarker,
} from "@/lib/kamino/timescale-reserve-monitor.shared";
import type { RebalanceRouteMode } from "./rebalance/rebalance-data";
import { RouteModeSwitch } from "./rebalance/route-mode-switch";

const COLLAPSED_REASON_LENGTH = 96;

const SERIES_STYLES: ReadonlyArray<{
  color: string;
  strokeOpacity?: number;
}> = [
  { color: "var(--chart-1)" },
  { color: "var(--chart-2)" },
  { color: "var(--chart-3)" },
  { color: "var(--chart-4)" },
  { color: "var(--chart-5)" },
  { color: "var(--foreground)", strokeOpacity: 0.78 },
] as const;

type TooltipPayloadItem = {
  color?: string;
  dataKey?: string | number;
  name?: string;
  value?: number | string;
};

type ApyTooltipProps = {
  active?: boolean;
  label?: unknown;
  labels: Record<string, string>;
  payload?: TooltipPayloadItem[];
};

function formatApyPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

export function CollapsibleReasonCell({ reason }: { reason: string }) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = reason.length > COLLAPSED_REASON_LENGTH;
  const visibleReason =
    canCollapse && !expanded
      ? `${reason.slice(0, COLLAPSED_REASON_LENGTH).trimEnd()}...`
      : reason;

  return (
    <div className="max-w-[24rem] text-xs text-muted-foreground">
      <span className="whitespace-normal break-words" title={reason}>
        {visibleReason}
      </span>
      {canCollapse ? (
        <Button
          className="ml-2 h-auto px-0 py-0 text-xs"
          onClick={() => setExpanded((value) => !value)}
          type="button"
          variant="link"
        >
          {expanded ? "Less" : "More"}
        </Button>
      ) : null}
    </div>
  );
}

function formatTickDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return String(value ?? "");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatTooltipDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return String(value ?? "");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function percentile(values: readonly number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * percentileValue))
  );

  return sorted[index];
}

function median(values: readonly number[]) {
  return percentile(values, 0.5);
}

function bucketChartPoints(data: SafeReserveApyMonitorData, bucketMs: number) {
  const windowStartedAtMs = Date.parse(data.window.startedAt);
  const buckets = new Map<number, Record<string, number[]>>();

  for (const point of data.chartPoints) {
    const observedAtMs =
      typeof point.observedAtMs === "number"
        ? point.observedAtMs
        : Date.parse(point.observedAt);
    if (!Number.isFinite(observedAtMs)) {
      continue;
    }

    const bucketTime =
      windowStartedAtMs +
      Math.floor((observedAtMs - windowStartedAtMs) / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketTime) ?? {};

    for (const series of data.series) {
      const value = point[series.key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }

      bucket[series.key] = [...(bucket[series.key] ?? []), value];
    }

    buckets.set(bucketTime, bucket);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([observedAtMs, bucket]) => {
      const chartPoint: SafeReserveApyMonitorData["chartPoints"][number] = {
        observedAt: new Date(observedAtMs).toISOString(),
        observedAtMs,
      };

      for (const series of data.series) {
        const values = bucket[series.key] ?? [];
        chartPoint[series.key] = values.length > 0 ? median(values) : null;
      }

      return chartPoint;
    });
}

function getApyValues(args: {
  chartPoints: SafeReserveApyMonitorData["chartPoints"];
  data: SafeReserveApyMonitorData;
}) {
  return args.chartPoints.flatMap((point) =>
    args.data.series.flatMap((series) => {
      const value = point[series.key];
      return typeof value === "number" && Number.isFinite(value) ? [value] : [];
    })
  );
}

function ApyTooltip({ active, label, labels, payload }: ApyTooltipProps) {
  const visiblePayload = (payload ?? []).filter(
    (item) => typeof item.value === "number"
  );

  if (!active || visiblePayload.length === 0) {
    return null;
  }

  return (
    <div className="grid min-w-[11rem] gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-foreground">
        {formatTooltipDate(label)}
      </div>
      <div className="grid gap-1">
        {visiblePayload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          const displayLabel = labels[key] ?? key;
          const value =
            typeof item.value === "number"
              ? formatApyPercent(item.value)
              : item.value;

          return (
            <div className="flex items-center justify-between gap-3" key={key}>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">{displayLabel}</span>
              </div>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SafeReserveApyChart({
  dataByRouteMode,
  decisionMarkersByRouteMode,
}: {
  dataByRouteMode: Record<RebalanceRouteMode, SafeReserveApyMonitorData>;
  decisionMarkersByRouteMode: Record<
    RebalanceRouteMode,
    SafeReserveRebalanceDecisionMarker[]
  >;
}) {
  const [routeMode, setRouteMode] = useState<RebalanceRouteMode>("same_mint");
  const data = dataByRouteMode[routeMode];
  const decisionMarkers = decisionMarkersByRouteMode[routeMode];
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null);
  const [showDecisionMarkers, setShowDecisionMarkers] = useState(false);
  const [showOutliers, setShowOutliers] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const chartConfig = data.series.reduce<ChartConfig>(
    (config, series, index) => {
      const style = SERIES_STYLES[index % SERIES_STYLES.length];

      return {
        ...config,
        [series.key]: {
          color: style.color,
          label: series.label,
        },
      };
    },
    {}
  );
  const seriesLabelByKey = data.series.reduce<Record<string, string>>(
    (labels, series) => ({
      ...labels,
      [series.key]: series.label,
    }),
    {}
  );

  const hasChartData =
    data.series.length > 0 &&
    data.chartPoints.some((point) =>
      data.series.some((series) => typeof point[series.key] === "number")
    );
  const chartPoints = useMemo(
    () =>
      showRawData ? data.chartPoints : bucketChartPoints(data, 30 * 60 * 1000),
    [data, showRawData]
  );
  const apyValues = useMemo(
    () => getApyValues({ chartPoints, data }),
    [chartPoints, data]
  );
  const fullYMax = Math.max(8, Math.ceil(Math.max(...apyValues, 0) + 1));
  const normalYMax = Math.max(
    8,
    Math.min(12, Math.ceil(percentile(apyValues, 0.95) + 1))
  );
  const yMax = showOutliers ? fullYMax : normalYMax;
  const windowStartedAtMs = Date.parse(data.window.startedAt);
  const windowEndedAtMs = Date.parse(data.window.endedAt);
  const visibleDecisionMarkers = decisionMarkers
    .filter((marker) => {
      const createdAtMs = Date.parse(marker.createdAt);
      return (
        Number.isFinite(createdAtMs) &&
        createdAtMs >= windowStartedAtMs &&
        createdAtMs <= windowEndedAtMs
      );
    })
    .slice(0, 25);

  return (
    <Card className="mx-auto w-full max-w-4xl py-4 sm:py-0">
      <CardHeader className="flex flex-col items-start justify-between gap-3 border-b sm:flex-row sm:items-center">
        <div>
          <CardTitle className="font-bold">Safe reserve APY</CardTitle>
          <CardDescription>
            {routeMode === "cross_mint"
              ? "Best currently eligible Safe reserve for each Crossmint target mint"
              : "Selected stablecoin Safe basket"}
            , last 7d,{" "}
            {showRawData
              ? `${data.sampleIntervalMinutes}m raw buckets`
              : "30m median view"}{" "}
            from Kamino Timescale
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <RouteModeSwitch
            id="safe-reserve-apy-route-mode"
            mode={routeMode}
            onModeChange={setRouteMode}
          />
          <Button
            onClick={() => setShowRawData((value) => !value)}
            size="sm"
            type="button"
            variant={showRawData ? "secondary" : "outline"}
          >
            {showRawData ? "Clean view" : "Raw 5m"}
          </Button>
          {decisionMarkers.length > 0 ? (
            <Button
              onClick={() => setShowDecisionMarkers((value) => !value)}
              size="sm"
              type="button"
              variant={showDecisionMarkers ? "secondary" : "outline"}
            >
              {showDecisionMarkers ? "Hide markers" : "Show markers"}
            </Button>
          ) : null}
          {fullYMax > normalYMax ? (
            <Button
              onClick={() => setShowOutliers((value) => !value)}
              size="sm"
              type="button"
              variant={showOutliers ? "secondary" : "outline"}
            >
              {showOutliers ? "Hide outliers" : "Show outliers"}
            </Button>
          ) : null}
          <div className="text-right text-xs text-muted-foreground tabular-nums">
            Updated {formatTooltipDate(data.generatedAt)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-6 sm:p-6">
        {hasChartData ? (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[300px] w-full min-w-0"
          >
            <LineChart
              accessibilityLayer
              data={chartPoints}
              margin={{ bottom: 24, left: 10, right: 18, top: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="observedAtMs"
                domain={["dataMin", "dataMax"]}
                minTickGap={36}
                type="number"
                tickFormatter={formatTickDate}
                tickLine={false}
                tickMargin={8}
              >
                <Label
                  offset={-16}
                  position="insideBottom"
                  value="Time (UTC)"
                />
              </XAxis>
              <YAxis
                allowDataOverflow
                allowDecimals
                axisLine={false}
                domain={[0, yMax]}
                tickFormatter={(value) =>
                  typeof value === "number" ? value.toFixed(1) : String(value)
                }
                tickLine={false}
                width={44}
              >
                <Label
                  angle={-90}
                  position="insideLeft"
                  style={{ textAnchor: "middle" }}
                  value="APY (%)"
                />
              </YAxis>
              <ChartTooltip
                content={<ApyTooltip labels={seriesLabelByKey} />}
              />
              {showDecisionMarkers
                ? visibleDecisionMarkers.map((marker) => (
                    <ReferenceLine
                      ifOverflow="visible"
                      key={marker.id}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="3 3"
                      strokeOpacity={
                        marker.status === "confirmed" ? 0.32 : 0.18
                      }
                      x={Date.parse(marker.createdAt)}
                    />
                  ))
                : null}
              {data.series.map((series, index) => {
                const style = SERIES_STYLES[index % SERIES_STYLES.length];
                const isFocused = focusedSeriesKey === series.key;
                const isMuted =
                  focusedSeriesKey !== null && focusedSeriesKey !== series.key;

                return (
                  <Line
                    connectNulls={false}
                    dataKey={series.key}
                    dot={false}
                    key={series.key}
                    onMouseEnter={() => setFocusedSeriesKey(series.key)}
                    onMouseLeave={() => setFocusedSeriesKey(null)}
                    stroke={`var(--color-${series.key})`}
                    strokeOpacity={isMuted ? 0.18 : style.strokeOpacity ?? 1}
                    strokeWidth={isFocused ? 3 : 2}
                    type={showRawData ? "stepAfter" : "linear"}
                  />
                );
              })}
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            No supported stablecoin Safe reserve APY samples found for this
            window.
          </div>
        )}

        {data.series.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {data.series.map((series, index) => {
              const style = SERIES_STYLES[index % SERIES_STYLES.length];

              return (
                <button
                  className="inline-flex items-center gap-2 rounded-sm outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
                  key={series.key}
                  onBlur={() => setFocusedSeriesKey(null)}
                  onFocus={() => setFocusedSeriesKey(series.key)}
                  onMouseEnter={() => setFocusedSeriesKey(series.key)}
                  onMouseLeave={() => setFocusedSeriesKey(null)}
                  type="button"
                >
                  <span
                    aria-hidden
                    className="h-px w-5"
                    style={{
                      borderTop: `2px solid ${style.color}`,
                      opacity: style.strokeOpacity ?? 1,
                    }}
                  />
                  <span>{series.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
