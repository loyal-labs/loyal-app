"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

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
  MetricPoint,
  MetricsDashboardData,
  OperationVolume,
} from "./metrics-data";

/** Fixed slot order; see the --metric-* comment in globals.css. */
const SERIES_SLOT_COUNT = 6;

/**
 * Operations with fewer buckets than this cannot show a trend — a line drawn
 * through two points days apart invents one. They render as value tiles.
 */
const MIN_BUCKETS_FOR_TREND = 6;

/** Clamping the axis is only worth the confusion when an outlier really dwarfs the rest. */
const OUTLIER_RATIO = 1.5;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Never collapse the axis below this, however short the measured history is. */
const MIN_WINDOW_MS = DAY_MS;

type Surface = "desktop" | "mobile";

type SeriesSpec = {
  identity: string;
  key: string;
  label: string;
  outcome: string;
  slot: number;
};

type OperationChart = {
  bucketCount: number;
  data: Array<Record<string, number | null>>;
  latestByKey: Record<string, number>;
  operation: string;
  series: SeriesSpec[];
  volume: OperationVolume | null;
};

const ACRONYMS: Record<string, string> = {
  api: "API",
  ios: "iOS",
  rpc: "RPC",
  ui: "UI",
  url: "URL",
};

function humanize(value: string): string {
  return value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word, index) => {
      const acronym = ACRONYMS[word.toLowerCase()];
      if (acronym) {
        return acronym;
      }
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

function humanizePath(value: string): string {
  return value.split(".").map(humanize).join(" · ");
}

/**
 * Latency spans three orders of magnitude here, so a single unit either hides
 * sub-second dependencies or turns a two-minute withdrawal into "140000".
 */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatUtcDay(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** A multi-day axis reads by date; a one-day axis needs the hour to say anything. */
function formatUtcTick(value: number, spanMs: number): string {
  if (spanMs > 2 * DAY_MS) {
    return formatUtcDay(value);
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatUtcTimestamp(value: unknown): string {
  const date = new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value ?? "");
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function percentile(values: readonly number[], level: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * level))
  );
  return sorted[index];
}

/**
 * What a series *is*, separate from how it ended. Outcome rides on the line
 * style instead of doubling the colour count and repeating "· completed" on
 * every legend row.
 */
function seriesIdentity(point: MetricPoint, surface: Surface): string {
  if (surface === "mobile") {
    return point.platform;
  }
  const phase = point.phase ?? "total";
  return point.dependency ? `${phase}:${point.dependency}` : phase;
}

function identityLabel(identity: string): string {
  const [phase, dependency] = identity.split(":");
  return humanize(dependency ?? phase);
}

/**
 * Colour follows the entity, not its position in this card's sorted list, so a
 * dependency keeps one colour across every chart on the surface.
 */
function buildSlotsByIdentity(
  points: MetricPoint[],
  surface: Surface
): Map<string, number> {
  const identities = [
    ...new Set(points.map((point) => seriesIdentity(point, surface))),
  ].sort();
  // Past the last slot, fall back to the neutral rather than cycling — two
  // identities wearing the same hue is worse than one wearing none.
  return new Map(
    identities.map((identity, index) => [
      identity,
      index < SERIES_SLOT_COUNT ? index + 1 : 0,
    ])
  );
}

function slotColor(slot: number): string {
  return slot === 0 ? "var(--muted-foreground)" : `var(--metric-${slot})`;
}

const Y_AXIS_INTERVALS = 4;

/** Round up to a step that divides cleanly, so ticks are whole numbers. */
function niceStep(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
    (candidate) => normalized <= candidate
  );
  return (step ?? 10) * magnitude;
}

/** Evenly spaced ticks from a nice step beats whatever Recharts infers from a clamped domain. */
function buildValueAxis(maxValue: number): { max: number; ticks: number[] } {
  const step = niceStep(Math.max(maxValue, 1) / Y_AXIS_INTERVALS);
  return {
    max: step * Y_AXIS_INTERVALS,
    ticks: Array.from(
      { length: Y_AXIS_INTERVALS + 1 },
      (_, index) => step * index
    ),
  };
}

/** One unit for the whole axis — mixing "50s" and "1.3m" hides even spacing. */
function formatAxisValue(ms: number, axisMax: number): string {
  if (axisMax < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  if (axisMax < 300_000) {
    const seconds = ms / 1_000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * One shared axis for every card, trimmed to the first bucket that actually
 * carries a measurement. Instrumentation younger than the window would
 * otherwise leave most of every plot empty, which reads as a broken chart
 * rather than as "not collected yet". The grid grows back to the full window
 * on its own as history accumulates.
 */
function buildBucketGrid(data: MetricsDashboardData): number[] {
  const bucketMs = data.bucketMinutes * 60 * 1_000;
  const windowStart =
    Math.floor(Date.parse(data.rangeStartedAt) / bucketMs) * bucketMs;
  const end = Date.parse(data.rangeEndedAt);

  let earliestSample = Number.POSITIVE_INFINITY;
  for (const points of [data.desktop, data.mobile]) {
    for (const point of points) {
      earliestSample = Math.min(earliestSample, Date.parse(point.bucketStartedAt));
    }
  }

  const start = Number.isFinite(earliestSample)
    ? Math.max(
        windowStart,
        // Keep at least a day of context around a single busy afternoon.
        Math.min(
          Math.floor(earliestSample / bucketMs) * bucketMs,
          end - MIN_WINDOW_MS
        )
      )
    : windowStart;

  const buckets: number[] = [];
  for (let time = start; time <= end; time += bucketMs) {
    buckets.push(time);
  }

  return buckets;
}

/**
 * Tick step and label format are chosen together: sub-day steps would print
 * duplicate date-only labels, and day steps on a short window print two ticks.
 */
function buildAxisTicks(bucketGrid: number[]): number[] {
  const span = bucketGrid[bucketGrid.length - 1] - bucketGrid[0];
  const step =
    span > 2 * DAY_MS ? DAY_MS : span > DAY_MS ? DAY_MS / 2 : DAY_MS / 4;
  return bucketGrid.filter((time) => time % step === 0);
}

function buildOperationCharts({
  bucketGrid,
  points,
  slotsByIdentity,
  surface,
  volume,
}: {
  bucketGrid: number[];
  points: MetricPoint[];
  slotsByIdentity: Map<string, number>;
  surface: Surface;
  volume: Record<string, OperationVolume>;
}): OperationChart[] {
  const byOperation = new Map<string, MetricPoint[]>();
  for (const point of points) {
    const operationPoints = byOperation.get(point.operation) ?? [];
    operationPoints.push(point);
    byOperation.set(point.operation, operationPoints);
  }

  return [...byOperation.entries()]
    .map(([operation, operationPoints]) => {
      const specByLabel = new Map<string, SeriesSpec>();
      for (const point of operationPoints) {
        const identity = seriesIdentity(point, surface);
        const label = identityLabel(identity);
        const seriesLabel =
          point.outcome === "completed"
            ? label
            : `${label} · ${humanize(point.outcome)}`;
        if (specByLabel.has(seriesLabel)) {
          continue;
        }
        specByLabel.set(seriesLabel, {
          identity,
          key: "",
          label: seriesLabel,
          outcome: point.outcome,
          slot: slotsByIdentity.get(identity) ?? 1,
        });
      }

      const series = [...specByLabel.values()]
        .sort(
          (left, right) =>
            left.slot - right.slot || left.label.localeCompare(right.label)
        )
        .map((spec, index) => ({ ...spec, key: `series${index}` }));

      const keyByLabel = new Map(
        series.map((spec) => [spec.label, spec.key] as const)
      );
      const valuesByBucket = new Map<number, Record<string, number>>();

      for (const point of operationPoints) {
        const identity = seriesIdentity(point, surface);
        const label = identityLabel(identity);
        const seriesLabel =
          point.outcome === "completed"
            ? label
            : `${label} · ${humanize(point.outcome)}`;
        const key = keyByLabel.get(seriesLabel);
        const bucketTime = Date.parse(point.bucketStartedAt);
        if (!key || !Number.isFinite(bucketTime)) {
          continue;
        }
        const bucket = valuesByBucket.get(bucketTime) ?? {};
        bucket[key] = point.p95Ms;
        valuesByBucket.set(bucketTime, bucket);
      }

      // Every bucket in the window gets a row, so gaps stay gaps instead of
      // being interpolated into a trend that was never measured.
      const data = bucketGrid.map((bucketTime) => {
        const bucket = valuesByBucket.get(bucketTime);
        const row: Record<string, number | null> = { bucketTime };
        for (const spec of series) {
          row[spec.key] = bucket?.[spec.key] ?? null;
        }
        return row;
      });

      const latestByKey: Record<string, number> = {};
      for (const spec of series) {
        for (let index = data.length - 1; index >= 0; index -= 1) {
          const value = data[index][spec.key];
          if (typeof value === "number") {
            latestByKey[spec.key] = value;
            break;
          }
        }
      }

      return {
        bucketCount: valuesByBucket.size,
        data,
        latestByKey,
        operation,
        series,
        volume: volume[operation] ?? null,
      };
    })
    .sort(
      (left, right) =>
        (right.volume?.total ?? 0) - (left.volume?.total ?? 0) ||
        right.bucketCount - left.bucketCount ||
        left.operation.localeCompare(right.operation)
    );
}

function SeriesSwatch({ spec }: { spec: SeriesSpec }) {
  const isFailure = spec.outcome !== "completed";
  return (
    <span
      aria-hidden
      className="h-0.5 w-4 shrink-0 rounded-full"
      style={
        isFailure
          ? {
              backgroundImage: `repeating-linear-gradient(to right, ${slotColor(spec.slot)} 0 4px, transparent 4px 7px)`,
            }
          : { backgroundColor: slotColor(spec.slot) }
      }
    />
  );
}

/**
 * The legend carries each series' latest value, so a reader never depends on
 * the colour alone or on hovering to read a number.
 */
function ChartLegend({
  latestByKey,
  series,
}: {
  latestByKey: Record<string, number>;
  series: SeriesSpec[];
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
      {series.map((spec) => (
        <div className="flex items-center gap-2" key={spec.key}>
          <SeriesSwatch spec={spec} />
          <span className="text-muted-foreground">{spec.label}</span>
          <span className="font-medium text-foreground tabular-nums">
            {latestByKey[spec.key] === undefined
              ? "—"
              : formatDuration(latestByKey[spec.key])}
          </span>
        </div>
      ))}
    </div>
  );
}

function MetricTooltip({
  active,
  label,
  payload,
  series,
}: {
  active?: boolean;
  label?: unknown;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  series: SeriesSpec[];
}) {
  const specByKey = new Map(series.map((spec) => [spec.key, spec] as const));
  const rows = (payload ?? []).filter(
    (item) => typeof item.value === "number"
  ) as Array<{ dataKey: string; value: number }>;

  if (!active || rows.length === 0) {
    return null;
  }

  return (
    <div className="grid min-w-[13rem] gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-foreground">
        {formatUtcTimestamp(label)}
      </div>
      <div className="grid gap-1">
        {rows.map((row) => {
          const spec = specByKey.get(row.dataKey);
          if (!spec) {
            return null;
          }
          return (
            <div
              className="flex items-center justify-between gap-3"
              key={row.dataKey}
            >
              <div className="flex items-center gap-2">
                <SeriesSwatch spec={spec} />
                <span className="text-muted-foreground">{spec.label}</span>
              </div>
              <span className="font-medium text-foreground tabular-nums">
                {formatDuration(row.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Sparse operations get their numbers directly — a line through 2 points is a lie. */
function ValueTiles({
  latestByKey,
  series,
}: {
  latestByKey: Record<string, number>;
  series: SeriesSpec[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {series.map((spec) => (
        <div className="rounded-md border px-3 py-2.5" key={spec.key}>
          <div className="flex items-center gap-2">
            <SeriesSwatch spec={spec} />
            <span className="truncate text-xs text-muted-foreground">
              {spec.label}
            </span>
          </div>
          <div className="mt-1 text-xl leading-none font-semibold">
            {latestByKey[spec.key] === undefined
              ? "—"
              : formatDuration(latestByKey[spec.key])}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricChartCard({
  bucketGrid,
  chart,
}: {
  bucketGrid: number[];
  chart: OperationChart;
}) {
  const [showOutliers, setShowOutliers] = useState(false);

  const values = useMemo(
    () =>
      chart.data.flatMap((row) =>
        chart.series.flatMap((spec) => {
          const value = row[spec.key];
          return typeof value === "number" ? [value] : [];
        })
      ),
    [chart]
  );

  const fullMax = values.length > 0 ? Math.max(...values) : 0;
  const robustMax = percentile(values, 0.95);
  const hasOutliers = fullMax > robustMax * OUTLIER_RATIO && robustMax > 0;
  const valueAxis = buildValueAxis(
    hasOutliers && !showOutliers ? robustMax : fullMax
  );
  const clippedCount = values.filter((value) => value > valueAxis.max).length;

  const config = useMemo(
    () =>
      Object.fromEntries(
        chart.series.map((spec) => [
          spec.key,
          { color: slotColor(spec.slot), label: spec.label },
        ])
      ) satisfies ChartConfig,
    [chart.series]
  );

  const showTrend = chart.bucketCount >= MIN_BUCKETS_FOR_TREND;
  const volume = chart.volume;
  const axisSpan = bucketGrid[bucketGrid.length - 1] - bucketGrid[0];

  return (
    <Card className="min-w-0 gap-4">
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>{humanizePath(chart.operation)}</CardTitle>
          {showTrend && hasOutliers ? (
            <Button
              className="h-6 px-2 text-xs"
              onClick={() => setShowOutliers((value) => !value)}
              size="sm"
              type="button"
              variant={showOutliers ? "secondary" : "outline"}
            >
              {showOutliers ? "Clip outliers" : `Show ${clippedCount} above`}
            </Button>
          ) : null}
        </div>
        <CardDescription className="tabular-nums">
          {volume
            ? `${volume.total.toLocaleString()} ${volume.total === 1 ? "sample" : "samples"}`
            : "p95 latency"}
          {volume && volume.failed > 0
            ? ` · ${volume.failed.toLocaleString()} failed`
            : ""}
          {` · ${chart.bucketCount} of ${bucketGrid.length} buckets`}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {showTrend ? (
          <ChartLegend latestByKey={chart.latestByKey} series={chart.series} />
        ) : null}
        {showTrend ? (
          <ChartContainer
            className="aspect-auto h-[220px] w-full min-w-0"
            config={config}
          >
            <LineChart
              accessibilityLayer
              data={chart.data}
              margin={{ bottom: 4, left: 4, right: 12, top: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="bucketTime"
                domain={[bucketGrid[0], bucketGrid[bucketGrid.length - 1]]}
                scale="time"
                tickFormatter={(value: number) => formatUtcTick(value, axisSpan)}
                tickLine={false}
                tickMargin={8}
                ticks={buildAxisTicks(bucketGrid)}
                type="number"
              />
              <YAxis
                allowDataOverflow
                axisLine={false}
                domain={[0, valueAxis.max]}
                tickFormatter={(value: number) =>
                  formatAxisValue(value, valueAxis.max)
                }
                tickLine={false}
                ticks={valueAxis.ticks}
                width={52}
              />
              <ChartTooltip
                content={<MetricTooltip series={chart.series} />}
                cursor={{ strokeDasharray: "3 3" }}
              />
              {chart.series.map((spec) => (
                <Line
                  activeDot={{
                    fill: `var(--color-${spec.key})`,
                    r: 4,
                    strokeWidth: 0,
                  }}
                  connectNulls={false}
                  dataKey={spec.key}
                  // Recharts fills dots with the background by default, which
                  // makes a bucket with no neighbour — and so no line segment —
                  // invisible. These carry the sparse points.
                  dot={{
                    fill: `var(--color-${spec.key})`,
                    r: 2,
                    strokeWidth: 0,
                  }}
                  key={spec.key}
                  stroke={`var(--color-${spec.key})`}
                  strokeDasharray={
                    spec.outcome === "completed" ? undefined : "4 3"
                  }
                  strokeWidth={2}
                  type="linear"
                />
              ))}
            </LineChart>
          </ChartContainer>
        ) : (
          <ValueTiles latestByKey={chart.latestByKey} series={chart.series} />
        )}
      </CardContent>
    </Card>
  );
}

function EmptyStateCard({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function SurfaceSection({
  bucketGrid,
  points,
  status,
  surface,
  volume,
}: {
  bucketGrid: number[];
  points: MetricPoint[];
  status: "available" | "unavailable";
  surface: Surface;
  volume: Record<string, OperationVolume>;
}) {
  const charts = useMemo(() => {
    const slotsByIdentity = buildSlotsByIdentity(points, surface);
    return buildOperationCharts({
      bucketGrid,
      points,
      slotsByIdentity,
      surface,
      volume,
    });
  }, [bucketGrid, points, surface, volume]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">
          {surface === "desktop" ? "Desktop" : "Mobile"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {surface === "desktop"
            ? "Web app loading and Earn interaction latency."
            : "iOS and Android app loading and Earn operation latency."}
        </p>
      </div>
      {status === "unavailable" ? (
        <EmptyStateCard
          description="ClickStack could not be queried. Check the server-side admin configuration."
          title="Metrics unavailable"
        />
      ) : charts.length === 0 ? (
        <EmptyStateCard
          description="No production measurements arrived during this 7-day window."
          title="No recent metrics"
        />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          {charts.map((chart) => (
            <MetricChartCard
              bucketGrid={bucketGrid}
              chart={chart}
              key={chart.operation}
            />
          ))}
        </div>
      )}
    </section>
  );
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

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function MetricsDashboard({ data }: { data: MetricsDashboardData }) {
  const latestSampleAt = getLatestSampleAt(data);
  const bucketGrid = useMemo(() => buildBucketGrid(data), [data]);
  const isTrimmed =
    bucketGrid[0] - Date.parse(data.rangeStartedAt) > data.bucketMinutes * 60_000;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-x-10 gap-y-3 rounded-lg border bg-card px-4 py-3">
        <MetaItem
          label="Plotted window"
          value={`${formatUtcDay(bucketGrid[0])} – ${formatUtcDay(
            bucketGrid[bucketGrid.length - 1]
          )} UTC`}
        />
        {isTrimmed ? (
          <MetaItem
            label="Queried window"
            value={`7 days · no samples before ${formatUtcDay(bucketGrid[0])}`}
          />
        ) : null}
        <MetaItem label="Bucket" value={`${data.bucketMinutes / 60}h · p95`} />
        <MetaItem
          label="Latest sample"
          value={latestSampleAt ? formatUtcTimestamp(latestSampleAt) : "—"}
        />
        <MetaItem label="Queried" value={formatUtcTimestamp(data.fetchedAt)} />
      </div>
      <SurfaceSection
        bucketGrid={bucketGrid}
        points={data.desktop}
        status={data.status.desktop}
        surface="desktop"
        volume={data.volume.desktop}
      />
      <SurfaceSection
        bucketGrid={bucketGrid}
        points={data.mobile}
        status={data.status.mobile}
        surface="mobile"
        volume={data.volume.mobile}
      />
    </div>
  );
}
