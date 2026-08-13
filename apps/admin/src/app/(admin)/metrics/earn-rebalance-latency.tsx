"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { formatShortAddress } from "@/components/blockchain/address-link";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEarnStablecoinSymbol } from "@/lib/earn/stablecoin-monitor.shared";

import type {
  EarnLatencyPoint,
  EarnLatencyStageKey,
  EarnLatencyStageSummary,
  EarnRebalanceLatencyData,
} from "./earn-rebalance-latency-data";

const DAY_MS = 24 * 60 * 60 * 1_000;

type LatencySeriesKey = EarnLatencyStageKey | "monitorToSubmittedMs";
type RangeKey = "7d" | "30d" | "all";

type ScatterPoint = EarnLatencyPoint & {
  durationMs: number;
  seriesLabel: string;
  submittedAtMs: number;
};

const SERIES: ReadonlyArray<{
  color: string;
  key: LatencySeriesKey;
  label: string;
}> = [
  {
    color: "var(--chart-1)",
    key: "monitorToSubmittedMs",
    label: "Target observed → submitted",
  },
  {
    color: "var(--chart-2)",
    key: "observedToOpportunityMs",
    label: "Observed → opportunity",
  },
  {
    color: "var(--chart-3)",
    key: "opportunityToReadyMs",
    label: "Opportunity → ready",
  },
  {
    color: "var(--chart-4)",
    key: "readyToDecisionMs",
    label: "Ready → decision",
  },
  {
    color: "var(--chart-5)",
    key: "decisionToSignedMs",
    label: "Decision → signed",
  },
  {
    color: "var(--metric-2)",
    key: "signedToSubmittedMs",
    label: "Signed → submitted",
  },
  {
    color: "var(--metric-4)",
    key: "submittedToConfirmedMs",
    label: "Submitted → confirmed",
  },
];

const DEFAULT_SERIES: LatencySeriesKey[] = [
  "monitorToSubmittedMs",
  "observedToOpportunityMs",
  "submittedToConfirmedMs",
];

const chartConfig = Object.fromEntries(
  SERIES.map((series) => [
    series.key,
    { color: series.color, label: series.label },
  ])
) satisfies ChartConfig;

const stageChartConfig = {
  p50Ms: { color: "var(--chart-2)", label: "p50" },
  p95Ms: { color: "var(--chart-4)", label: "p95" },
} satisfies ChartConfig;

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatUtcTimestamp(value: number | string | null): string {
  if (value === null) {
    return "No data";
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
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

function formatUtcTick(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function LatencyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ScatterPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="grid min-w-[18rem] gap-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{point.seriesLabel}</div>
      <div className="text-lg font-semibold tabular-nums">
        {formatDuration(point.durationMs)}
      </div>
      <div className="text-muted-foreground">
        Submitted {formatUtcTimestamp(point.submittedAtMs)}
      </div>
      <div className="text-muted-foreground">
        {formatShortAddress(point.sourceReserve)} →{" "}
        {formatShortAddress(point.targetReserve)}
      </div>
      <div className="text-muted-foreground">
        Mint {getEarnStablecoinSymbol(point.liquidityMint) ?? "unknown"}
      </div>
      <div className="font-mono text-muted-foreground">
        Decision {point.decisionId}
      </div>
    </div>
  );
}

function StageTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: EarnLatencyStageSummary }>;
}) {
  const stage = payload?.[0]?.payload;
  if (!active || !stage) {
    return null;
  }

  return (
    <div className="grid min-w-[13rem] gap-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{stage.label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">p50</span>
        <span className="font-medium tabular-nums">
          {formatDuration(stage.p50Ms)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">p95</span>
        <span className="font-medium tabular-nums">
          {formatDuration(stage.p95Ms)}
        </span>
      </div>
      <div className="text-muted-foreground">
        {stage.measuredCount.toLocaleString("en-US")} measured executions
      </div>
    </div>
  );
}

function SummaryCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function LatencyTable({
  points,
  selectedSeries,
}: {
  points: EarnLatencyPoint[];
  selectedSeries: LatencySeriesKey[];
}) {
  const rows = [...points].reverse().slice(0, 50);

  return (
    <div className="max-h-[420px] overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>Submitted (UTC)</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead>Mint</TableHead>
            <TableHead>Route</TableHead>
            {selectedSeries.map((key) => (
              <TableHead className="text-right whitespace-nowrap" key={key}>
                {SERIES.find((series) => series.key === key)?.label ?? key}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((point) => (
            <TableRow key={point.decisionId}>
              <TableCell className="whitespace-nowrap">
                {formatUtcTimestamp(point.submittedAt)}
              </TableCell>
              <TableCell className="font-mono">{point.decisionId}</TableCell>
              <TableCell className="font-medium">
                {getEarnStablecoinSymbol(point.liquidityMint) ?? "Unknown"}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono">
                {formatShortAddress(point.sourceReserve)} →{" "}
                {formatShortAddress(point.targetReserve)}
              </TableCell>
              {selectedSeries.map((key) => (
                <TableCell
                  className="text-right whitespace-nowrap tabular-nums"
                  key={key}
                >
                  {typeof point[key] === "number"
                    ? formatDuration(point[key] as number)
                    : "Not measured"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EarnRebalanceLatency({
  data,
}: {
  data: EarnRebalanceLatencyData;
}) {
  const [range, setRange] = useState<RangeKey>("all");
  const [selectedSeries, setSelectedSeries] =
    useState<LatencySeriesKey[]>(DEFAULT_SERIES);
  const [showTable, setShowTable] = useState(false);

  const filteredPoints = useMemo(() => {
    if (range === "all" || data.points.length === 0) {
      return data.points;
    }
    const latest = Date.parse(data.points[data.points.length - 1].submittedAt);
    const days = range === "7d" ? 7 : 30;
    return data.points.filter(
      (point) => Date.parse(point.submittedAt) >= latest - days * DAY_MS
    );
  }, [data.points, range]);

  const scatterBySeries = useMemo(
    () =>
      new Map(
        SERIES.map((series) => [
          series.key,
          filteredPoints.flatMap((point): ScatterPoint[] => {
            const duration = point[series.key];
            if (typeof duration !== "number") {
              return [];
            }
            return [
              {
                ...point,
                durationMs: duration,
                seriesLabel: series.label,
                submittedAtMs: Date.parse(point.submittedAt),
              },
            ];
          }),
        ])
      ),
    [filteredPoints]
  );

  function toggleSeries(key: LatencySeriesKey) {
    setSelectedSeries((current) => {
      if (current.includes(key)) {
        return current.length === 1
          ? current
          : current.filter((value) => value !== key);
      }
      return [...current, key];
    });
  }

  if (data.status === "unavailable") {
    return (
      <section aria-labelledby="earn-rebalance-latency-title">
        <Card>
          <CardHeader>
            <CardTitle id="earn-rebalance-latency-title">
              Earn rebalance latency
            </CardTitle>
            <CardDescription>
              Yield Neon latency data is temporarily unavailable. The ClickStack
              metrics below remain independent and available.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="earn-rebalance-latency-title"
      className="space-y-5"
    >
      <div>
        <h2
          className="text-xl font-semibold tracking-tight"
          id="earn-rebalance-latency-title"
        >
          Earn rebalance latency
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Durable Yield Neon boundaries for confirmed reserve-to-reserve
          decisions. The monitor boundary is the destination Kamino reserve’s
          optimizer-epoch observation; all times are UTC.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          detail={`${data.measuredCount.toLocaleString(
            "en-US"
          )} of ${data.totalConfirmed.toLocaleString(
            "en-US"
          )} confirmed executions`}
          label="Measured executions"
          value={`${(
            (data.measuredCount / Math.max(data.totalConfirmed, 1)) *
            100
          ).toFixed(1)}%`}
        />
        <SummaryCard
          detail={`p95 ${formatDuration(data.monitorToSubmittedP95Ms)}`}
          label="Target monitor → submitted"
          value={formatDuration(data.monitorToSubmittedP50Ms)}
        />
        <SummaryCard
          detail={`p95 ${formatDuration(data.submittedToConfirmedP95Ms)}`}
          label="Submitted → confirmed"
          value={formatDuration(data.submittedToConfirmedP50Ms)}
        />
        <SummaryCard
          detail={`Through ${formatUtcTimestamp(data.rangeEndedAt)}`}
          label="Measured window"
          value={
            data.rangeStartedAt
              ? new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  timeZone: "UTC",
                  year: "numeric",
                }).format(new Date(data.rangeStartedAt))
              : "No data"
          }
        />
      </div>

      <Card className="min-w-0">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Actual rebalance transaction latency</CardTitle>
              <CardDescription>
                One dot per measured execution and enabled stage; X is first
                submission time and Y is elapsed time.
              </CardDescription>
            </div>
            <div
              className="flex flex-wrap gap-1"
              aria-label="Latency chart range"
            >
              {(["7d", "30d", "all"] as const).map((value) => (
                <Button
                  aria-pressed={range === value}
                  key={value}
                  onClick={() => setRange(value)}
                  size="sm"
                  type="button"
                  variant={range === value ? "secondary" : "outline"}
                >
                  {value === "all" ? "All" : value}
                </Button>
              ))}
              <Button
                aria-pressed={showTable}
                onClick={() => setShowTable((value) => !value)}
                size="sm"
                type="button"
                variant={showTable ? "secondary" : "outline"}
              >
                Table
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Latency stages">
            {SERIES.map((series) => {
              const selected = selectedSeries.includes(series.key);
              return (
                <Button
                  aria-pressed={selected}
                  className="h-7 gap-1.5 px-2 text-xs"
                  key={series.key}
                  onClick={() => toggleSeries(series.key)}
                  size="sm"
                  type="button"
                  variant={selected ? "secondary" : "outline"}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: series.color }}
                  />
                  {series.label}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {filteredPoints.length.toLocaleString("en-US")} executions in the
            selected range · updated {formatUtcTimestamp(data.fetchedAt)}
          </p>
        </CardHeader>
        <CardContent className="min-w-0">
          {showTable ? (
            <LatencyTable
              points={filteredPoints}
              selectedSeries={selectedSeries}
            />
          ) : (
            <ChartContainer
              className="aspect-auto h-[360px] w-full min-w-0"
              config={chartConfig}
            >
              <ScatterChart
                accessibilityLayer
                margin={{ bottom: 14, left: 8, right: 16, top: 12 }}
              >
                <CartesianGrid />
                <XAxis
                  axisLine={false}
                  dataKey="submittedAtMs"
                  domain={["dataMin", "dataMax"]}
                  name="First submission time"
                  tickFormatter={formatUtcTick}
                  tickLine={false}
                  tickMargin={8}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="durationMs"
                  name="Elapsed time"
                  tickFormatter={formatDuration}
                  tickLine={false}
                  width={58}
                />
                <ZAxis range={[18, 18]} />
                <ChartTooltip
                  content={<LatencyTooltip />}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                {SERIES.filter((series) =>
                  selectedSeries.includes(series.key)
                ).map((series) => (
                  <Scatter
                    data={scatterBySeries.get(series.key) ?? []}
                    fill={`var(--color-${series.key})`}
                    key={series.key}
                    name={series.label}
                  />
                ))}
              </ScatterChart>
            </ChartContainer>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Missing durable stage timestamps are excluded from that stage’s
            coverage, never replaced with zero. Historical planner-loop runtime
            remains in transient Render logs and is not presented here as
            durable database history.
          </p>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Where confirmed rebalances spend time</CardTitle>
          <CardDescription>
            p50 and p95 elapsed time by durable lifecycle stage. Coverage is
            printed with each stage because historical ready timestamps are
            incomplete.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <ChartContainer
            className="aspect-auto h-[320px] w-full min-w-0"
            config={stageChartConfig}
          >
            <BarChart
              accessibilityLayer
              data={data.stages}
              layout="vertical"
              margin={{ left: 16, right: 20 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                axisLine={false}
                tickFormatter={formatDuration}
                tickLine={false}
                type="number"
              />
              <YAxis
                axisLine={false}
                dataKey="label"
                tickLine={false}
                type="category"
                width={128}
              />
              <ChartTooltip content={<StageTooltip />} cursor={false} />
              <Bar
                dataKey="p50Ms"
                fill="var(--color-p50Ms)"
                radius={[0, 3, 3, 0]}
              />
              <Bar
                dataKey="p95Ms"
                fill="var(--color-p95Ms)"
                radius={[0, 3, 3, 0]}
              />
            </BarChart>
          </ChartContainer>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.stages.map((stage) => (
              <div
                className="rounded-md border px-3 py-2 text-xs"
                key={stage.key}
              >
                <div className="font-medium">{stage.label}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-muted-foreground">
                  <span>p50 {formatDuration(stage.p50Ms)}</span>
                  <span>p95 {formatDuration(stage.p95Ms)}</span>
                  <span>
                    {stage.measuredCount.toLocaleString("en-US")} measured
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
