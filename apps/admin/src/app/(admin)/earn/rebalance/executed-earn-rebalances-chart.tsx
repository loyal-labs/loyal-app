"use client";

import { useMemo, useState } from "react";
import {
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
import {
  getEarnStablecoinSymbol,
  STABLECOIN_DECIMALS,
} from "@/lib/earn/stablecoin-monitor.shared";

import { buildLogTicks, formatDepositTick } from "./earn-vault-rebalance-axis";
import { DepositScaleSwitch, type DepositScale } from "./deposit-scale-switch";
import type { RebalanceRouteMode } from "./rebalance-data";
import { RouteModeSwitch } from "./route-mode-switch";

const DAY_MS = 24 * 60 * 60 * 1_000;
const SOURCE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export type SerializedExecutedEarnRebalanceRow = {
  amountRaw: string;
  authority: string;
  confirmedSlot: string;
  currentDepositRaw: string;
  executedAt: string;
  id: string;
  liquidityMint: string | null;
  routeMode: RebalanceRouteMode;
  sourceReserve: string;
  sourceLiquidityMint: string | null;
  swapFeeLamports: string;
  targetReserve: string;
  targetLiquidityMint: string | null;
  userRank: number;
};

export type SerializedExecutedEarnRebalanceHistory = {
  chartPoints: SerializedExecutedEarnRebalanceRow[];
  details: SerializedExecutedEarnRebalanceRow[];
  generatedAt: string;
  status: "available" | "unavailable";
  summaries: SerializedExecutedEarnRebalanceSummary[];
};

export type SerializedExecutedEarnRebalanceSummary = {
  executionCount: number;
  executionCount30d: number;
  executionCount7d: number;
  fullyWithdrawnCount: number;
  fullyWithdrawnCount30d: number;
  fullyWithdrawnCount7d: number;
  liquidityMint: string | null;
  routeMode: RebalanceRouteMode;
  swapFeeLamports: string;
  userCount: number;
};

type ChartPoint = SerializedExecutedEarnRebalanceRow & {
  depositAmount: number;
  executedAtMs: number;
};

type RangeKey = "7d" | "30d" | "all";

function formatUtcTimestamp(value: number | string): string {
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

function formatStablecoinRaw(
  raw: string,
  liquidityMint: string | null
): string {
  const amount = BigInt(raw);
  const scale = BigInt(10) ** BigInt(STABLECOIN_DECIMALS);
  const whole = amount / scale;
  const fractional = amount % scale;

  return `${whole.toLocaleString("en-US")}.${fractional
    .toString()
    .padStart(STABLECOIN_DECIMALS, "0")
    .slice(0, 2)} ${getEarnStablecoinSymbol(liquidityMint) ?? "nominal USD"}`;
}

function formatCompactStablecoinRaw(raw: string): string {
  const amount = Number(BigInt(raw)) / 10 ** STABLECOIN_DECIMALS;

  return `$${new Intl.NumberFormat("en-US", {
    compactDisplay: "short",
    maximumFractionDigits: 2,
    notation: "compact",
  }).format(amount)}`;
}

function formatSwapFee(raw: string): string {
  return `${(Number(BigInt(raw)) / 1_000_000_000).toFixed(6)} SOL`;
}

function rangeLabel(range: RangeKey): string {
  if (range === "7d") {
    return "Last 7 days";
  }
  if (range === "30d") {
    return "Last 30 days";
  }
  return "All history";
}

function ExecutedRebalanceTooltip({
  active,
  payload,
  reserveLabels,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  reserveLabels: ReadonlyMap<string, string>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  const source =
    reserveLabels.get(point.sourceReserve) ??
    formatShortAddress(point.sourceReserve);
  const target =
    reserveLabels.get(point.targetReserve) ??
    formatShortAddress(point.targetReserve);

  return (
    <div className="grid min-w-[17rem] gap-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">
        {formatUtcTimestamp(point.executedAtMs)}
      </div>
      <div className="text-muted-foreground">
        {source} → {target}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1">
        <dt className="text-muted-foreground">Executed</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatStablecoinRaw(
            point.amountRaw,
            point.routeMode === "cross_mint"
              ? point.sourceLiquidityMint
              : point.liquidityMint
          )}
        </dd>
        {point.routeMode === "cross_mint" ? (
          <>
            <dt className="text-muted-foreground">Swap pair</dt>
            <dd className="text-right font-medium">
              {getEarnStablecoinSymbol(point.sourceLiquidityMint) ?? "Unknown"}{" "}
              →{" "}
              {getEarnStablecoinSymbol(point.targetLiquidityMint) ?? "Unknown"}
            </dd>
            <dt className="text-muted-foreground">Swap fee</dt>
            <dd className="text-right font-medium tabular-nums">
              {formatSwapFee(point.swapFeeLamports)}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">User deposit now</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatStablecoinRaw(point.currentDepositRaw, null)}
        </dd>
        <dt className="text-muted-foreground">User</dt>
        <dd className="text-right font-mono">
          {formatShortAddress(point.authority)} · rank {point.userRank}
        </dd>
        <dt className="text-muted-foreground">Decision</dt>
        <dd className="text-right font-mono">{point.id}</dd>
        <dt className="text-muted-foreground">Confirmed slot</dt>
        <dd className="text-right font-mono">{point.confirmedSlot}</dd>
      </dl>
    </div>
  );
}

export function ExecutedEarnRebalancesChart({
  data,
  reserveLabels,
}: {
  data: SerializedExecutedEarnRebalanceHistory;
  reserveLabels: ReadonlyMap<string, string>;
}) {
  const [range, setRange] = useState<RangeKey>("all");
  const [routeMode, setRouteMode] = useState<RebalanceRouteMode>("same_mint");
  const [scale, setScale] = useState<DepositScale>("log");
  const [showTable, setShowTable] = useState(false);
  const [detailRows, setDetailRows] = useState(data.details);
  const [detailStatus, setDetailStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");

  const points = useMemo(
    () =>
      data.chartPoints
        .filter((execution) => execution.routeMode === routeMode)
        .map((execution) => ({
          ...execution,
          depositAmount:
            Number(BigInt(execution.currentDepositRaw)) /
            10 ** STABLECOIN_DECIMALS,
          executedAtMs: Date.parse(execution.executedAt),
        }))
        .filter((execution) => Number.isFinite(execution.executedAtMs)),
    [data.chartPoints, routeMode]
  );

  const details = useMemo(
    () =>
      detailRows
        .filter((execution) => execution.routeMode === routeMode)
        .map((execution) => ({
          ...execution,
          depositAmount:
            Number(BigInt(execution.currentDepositRaw)) /
            10 ** STABLECOIN_DECIMALS,
          executedAtMs: Date.parse(execution.executedAt),
        }))
        .filter((execution) => Number.isFinite(execution.executedAtMs)),
    [detailRows, routeMode]
  );

  async function toggleTable() {
    if (showTable) {
      setShowTable(false);
      return;
    }
    if (detailRows.length > 0 || data.status !== "available") {
      setShowTable(true);
      return;
    }

    setDetailStatus("loading");
    try {
      const response = await fetch(
        "/api/earn/rebalance/details?kind=executed",
        {
          cache: "no-store",
          credentials: "same-origin",
        }
      );
      if (!response.ok) {
        throw new Error(`Execution details request failed: ${response.status}`);
      }
      const result = (await response.json()) as {
        details: SerializedExecutedEarnRebalanceRow[];
      };
      setDetailRows(result.details);
      setDetailStatus("idle");
      setShowTable(true);
    } catch {
      setDetailStatus("error");
    }
  }

  const filteredPoints = useMemo(() => {
    if (range === "all" || points.length === 0) {
      return points;
    }
    const latest = points[points.length - 1].executedAtMs;
    const days = range === "7d" ? 7 : 30;
    return points.filter(
      (point) => point.executedAtMs >= latest - days * DAY_MS
    );
  }, [points, range]);

  const filteredDetails = useMemo(() => {
    if (range === "all" || details.length === 0) {
      return details;
    }
    const latest = details[0].executedAtMs;
    const days = range === "7d" ? 7 : 30;
    return details.filter(
      (point) => point.executedAtMs >= latest - days * DAY_MS
    );
  }, [details, range]);

  const sourceReserves = useMemo(
    () => [...new Set(points.map((point) => point.sourceReserve))].sort(),
    [points]
  );
  const sources = sourceReserves.map((reserve, index) => ({
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
    key: `source${index}`,
    label: reserveLabels.get(reserve) ?? formatShortAddress(reserve),
    reserve,
  }));
  const config = Object.fromEntries(
    sources.map((source) => [
      source.key,
      { color: source.color, label: source.label },
    ])
  ) satisfies ChartConfig;

  const routeSummaries = data.summaries.filter(
    (item) => item.routeMode === routeMode
  );
  const exactExecutionCount = routeSummaries.reduce(
    (total, item) =>
      total +
      (range === "all"
        ? item.executionCount
        : range === "30d"
        ? item.executionCount30d
        : item.executionCount7d),
    0
  );
  const exactFullyWithdrawnCount = routeSummaries.reduce(
    (total, item) =>
      total +
      (range === "all"
        ? item.fullyWithdrawnCount
        : range === "30d"
        ? item.fullyWithdrawnCount30d
        : item.fullyWithdrawnCount7d),
    0
  );
  const distinctUserCount = routeSummaries.reduce(
    (total, item) => total + item.userCount,
    0
  );
  const positiveDeposits = filteredPoints
    .map((point) => point.depositAmount)
    .filter((amount) => amount > 0 && Number.isFinite(amount));
  const useLogScale = scale === "log" && positiveDeposits.length > 0;
  // Users who fully withdrew after rebalancing now hold nothing, and a log axis
  // has no room for zero. Pin them to one decade below the smallest real
  // deposit so the execution still shows up instead of being dropped.
  const logFloor = useLogScale
    ? 10 ** (Math.floor(Math.log10(Math.min(...positiveDeposits))) - 1)
    : 1;
  const logTicks = buildLogTicks(
    logFloor,
    useLogScale ? Math.max(...positiveDeposits) : 1
  );
  const maxDepositAmount =
    positiveDeposits.length > 0 ? Math.max(...positiveDeposits) : 1;
  const scatterPoints = filteredPoints.map((point) => ({
    ...point,
    logDepositAmount: point.depositAmount > 0 ? point.depositAmount : logFloor,
  }));
  const tableRows = filteredDetails.slice(0, 50);
  const swapFeeLamports = routeSummaries
    .reduce((total, item) => total + BigInt(item.swapFeeLamports), BigInt(0))
    .toString();

  if (data.status === "unavailable") {
    return (
      <Card
        className="min-w-0"
        aria-labelledby="executed-earn-rebalances-title"
      >
        <CardHeader>
          <CardTitle id="executed-earn-rebalances-title">
            Executed Earn rebalances
          </CardTitle>
          <CardDescription>
            Confirmed execution history is temporarily unavailable. The other
            Earn rebalance monitors remain independent and available.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="min-w-0" aria-labelledby="executed-earn-rebalances-title">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle id="executed-earn-rebalances-title">
              Executed Earn rebalances
            </CardTitle>
            <CardDescription>
              One dot per confirmed{" "}
              {routeMode === "cross_mint" ? "Crossmint" : "same-mint"}{" "}
              reserve-to-reserve decision. Y is the user&rsquo;s current Earn
              deposit, on a log or linear scale. Times are UTC.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
            <RouteModeSwitch
              id="executed-earn-rebalances-route-mode"
              mode={routeMode}
              onModeChange={setRouteMode}
            />
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div
                aria-label="Execution history range"
                className="inline-flex items-center rounded-lg bg-muted p-1"
                role="group"
              >
                {(["7d", "30d", "all"] as const).map((value) => (
                  <Button
                    aria-pressed={range === value}
                    className={
                      range === value
                        ? "h-7 bg-background px-2.5 text-xs shadow-xs hover:bg-background"
                        : "h-7 px-2.5 text-xs text-muted-foreground shadow-none"
                    }
                    key={value}
                    onClick={() => setRange(value)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {value === "all" ? "All" : value}
                  </Button>
                ))}
              </div>
              <Button
                aria-pressed={showTable}
                disabled={detailStatus === "loading"}
                onClick={() => void toggleTable()}
                size="sm"
                type="button"
                variant={showTable ? "secondary" : "outline"}
              >
                {detailStatus === "loading"
                  ? "Loading table…"
                  : detailStatus === "error"
                  ? "Retry table"
                  : "Table"}
              </Button>
            </div>
            {showTable ? null : (
              <DepositScaleSwitch
                id="executed-earn-rebalances-scale"
                onScaleChange={setScale}
                scale={scale}
              />
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            {exactExecutionCount.toLocaleString("en-US")} confirmed executions
          </span>
          <span>
            {distinctUserCount.toLocaleString("en-US")} distinct users
          </span>
          <span>
            {exactExecutionCount.toLocaleString("en-US")} shown ·{" "}
            {rangeLabel(range)}
          </span>
          <span>Updated {formatUtcTimestamp(data.generatedAt)}</span>
          {routeMode === "cross_mint" ? (
            <span className="font-medium text-foreground">
              {formatSwapFee(swapFeeLamports)} finalized swap fees
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {sources.map((source) => (
            <span className="inline-flex items-center gap-1.5" key={source.key}>
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: source.color }}
              />
              {source.label}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        {points.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            No confirmed{" "}
            {routeMode === "cross_mint" ? "Crossmint" : "same-mint"} Earn
            rebalances are available.
          </div>
        ) : showTable ? (
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Executed (UTC)</TableHead>
                  <TableHead>User</TableHead>
                  {routeMode === "cross_mint" ? (
                    <>
                      <TableHead>Source mint</TableHead>
                      <TableHead>Target mint</TableHead>
                    </>
                  ) : (
                    <TableHead>Mint</TableHead>
                  )}
                  <TableHead>Route</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead className="text-right">Confirmed slot</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {routeMode === "cross_mint" ? (
                    <TableHead className="text-right">Swap fee</TableHead>
                  ) : null}
                  <TableHead className="text-right">Current deposit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((point) => (
                  <TableRow key={point.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatUtcTimestamp(point.executedAtMs)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono">
                      {formatShortAddress(point.authority)} · {point.userRank}
                    </TableCell>
                    {routeMode === "cross_mint" ? (
                      <>
                        <TableCell className="font-medium">
                          {getEarnStablecoinSymbol(point.sourceLiquidityMint) ??
                            "Unknown"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {getEarnStablecoinSymbol(point.targetLiquidityMint) ??
                            "Unknown"}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell className="font-medium">
                        {getEarnStablecoinSymbol(point.liquidityMint) ??
                          "Unknown"}
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap">
                      {reserveLabels.get(point.sourceReserve) ??
                        formatShortAddress(point.sourceReserve)}{" "}
                      →{" "}
                      {reserveLabels.get(point.targetReserve) ??
                        formatShortAddress(point.targetReserve)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono">
                      {point.id}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap font-mono tabular-nums">
                      {point.confirmedSlot}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {formatStablecoinRaw(
                        point.amountRaw,
                        point.routeMode === "cross_mint"
                          ? point.sourceLiquidityMint
                          : point.liquidityMint
                      )}
                    </TableCell>
                    {routeMode === "cross_mint" ? (
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {formatSwapFee(point.swapFeeLamports)}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {formatStablecoinRaw(point.currentDepositRaw, null)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <ChartContainer
            className="aspect-auto h-[440px] w-full min-w-0"
            config={config}
          >
            <ScatterChart
              accessibilityLayer
              margin={{ bottom: 14, left: 12, right: 12, top: 12 }}
            >
              <CartesianGrid />
              <XAxis
                axisLine={false}
                dataKey="executedAtMs"
                domain={["dataMin", "dataMax"]}
                name="Execution time"
                tickFormatter={formatUtcTick}
                tickLine={false}
                tickMargin={8}
                type="number"
              />
              {useLogScale ? (
                <YAxis
                  allowDataOverflow
                  axisLine={false}
                  dataKey="logDepositAmount"
                  domain={[logTicks[0], logTicks[logTicks.length - 1] ?? 1]}
                  name="Current deposit amount"
                  scale="log"
                  tickFormatter={(amount: number) =>
                    formatDepositTick(amount, null)
                  }
                  tickLine={false}
                  ticks={logTicks}
                  type="number"
                  width={78}
                />
              ) : (
                <YAxis
                  axisLine={false}
                  dataKey="depositAmount"
                  domain={[0, Math.max(maxDepositAmount, 1)]}
                  name="Current deposit amount"
                  tickFormatter={(amount: number) =>
                    formatDepositTick(amount, null)
                  }
                  tickLine={false}
                  type="number"
                  width={78}
                />
              )}
              <ZAxis range={[18, 18]} />
              <ChartTooltip
                content={
                  <ExecutedRebalanceTooltip reserveLabels={reserveLabels} />
                }
                cursor={{ strokeDasharray: "3 3" }}
              />
              {sources.map((source) => (
                <Scatter
                  data={scatterPoints.filter(
                    (point) => point.sourceReserve === source.reserve
                  )}
                  fill={`var(--color-${source.key})`}
                  key={source.key}
                  name={source.label}
                />
              ))}
            </ScatterChart>
          </ChartContainer>
        )}
        {!showTable ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {useLogScale
              ? "Y-axis is a log scale of current deposit amounts"
              : "Y-axis labels sample current deposit amounts"}
            ; hover a dot for the exact wallet, current deposit, route, amount,
            decision, and slot.
            {useLogScale && exactFullyWithdrawnCount > 0
              ? ` ${exactFullyWithdrawnCount.toLocaleString(
                  "en-US"
                )} fully withdrawn ${
                  exactFullyWithdrawnCount === 1
                    ? "execution sits"
                    : "executions sit"
                } on the axis floor.`
              : ""}
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the exact 50 most recent executions in the selected range.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
