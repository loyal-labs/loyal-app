"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getEarnStablecoinSymbol,
  STABLECOIN_DECIMALS,
} from "@/lib/earn/stablecoin-monitor.shared";
import type { SafeReserveApyStatusRow } from "@/lib/kamino/timescale-reserve-monitor.shared";

import { buildLogTicks, formatDepositTick } from "./earn-vault-rebalance-axis";
import { DepositScaleSwitch, type DepositScale } from "./deposit-scale-switch";
import { computeRebalanceEligibilityFloorRaw } from "./earn-vault-rebalance-eligibility";
import type { RebalanceRouteMode } from "./rebalance-data";
import { RouteModeSwitch } from "./route-mode-switch";

const NO_RESERVE_KEY = "__no_current_reserve__";
const RESERVE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--foreground)",
] as const;

export type SerializedEarnVaultRebalanceFrequencyRow = {
  allCount: number;
  currentDepositRaw: string;
  currentReserve: string | null;
  depositRank: number;
  last12hCount: number;
  last2hCount: number;
  last7dCount: number;
  liquidityMint: string | null;
  positionCount: number;
  routeMode: RebalanceRouteMode;
  vaultId: string;
  vaultPubkey: string;
};

export type SerializedEarnVaultRebalanceFrequency = {
  chartPoints: SerializedEarnVaultRebalanceFrequencyRow[];
  details: SerializedEarnVaultRebalanceFrequencyRow[];
  generatedAt: string;
  status: "available" | "unavailable";
  summaries: SerializedEarnVaultRebalanceFrequencySummary[];
  vaultCount: number;
};

export type SerializedEarnVaultRebalanceFrequencySummary = {
  eligibleCount: number;
  eligibleCount12h: number;
  eligibleCount2h: number;
  eligibleCount7d: number;
  liquidityMint: string | null;
  positionCount: number;
  rebalance12hCount: number;
  rebalance2hCount: number;
  rebalance7dCount: number;
  rebalanceAllCount: number;
  rebalancedVaultCount: number;
  routeMode: RebalanceRouteMode;
  vaultCount: number;
};

type RangeKey = "12h" | "2h" | "7d" | "all";
type CountKey = "allCount" | "last7dCount" | "last12hCount" | "last2hCount";

type ChartPoint = SerializedEarnVaultRebalanceFrequencyRow & {
  depositAmount: number;
  depositRank: number;
  rebalanceCount: number;
};

type VaultOpportunityCounts = {
  allCount: number;
  last12hCount: number;
  last2hCount: number;
  last7dCount: number;
  routeMode: RebalanceRouteMode;
  vaultId: string;
};

type ReserveSeries = {
  apyStatus: SafeReserveApyStatusRow | null;
  color: string;
  key: string;
  label: string;
  reserve: string | null;
  reserveKey: string;
};

const RANGE_OPTIONS: ReadonlyArray<{
  countKey: CountKey;
  key: RangeKey;
  label: string;
  tabLabel: string;
}> = [
  {
    countKey: "allCount",
    key: "all",
    label: "All history",
    tabLabel: "All",
  },
  {
    countKey: "last7dCount",
    key: "7d",
    label: "Last 7 days",
    tabLabel: "7 days",
  },
  {
    countKey: "last12hCount",
    key: "12h",
    label: "Last 12 hours",
    tabLabel: "12 hours",
  },
  {
    countKey: "last2hCount",
    key: "2h",
    label: "Last 2 hours",
    tabLabel: "2 hours",
  },
];

function compareRawAmounts(left: string, right: string): number {
  const leftAmount = BigInt(left);
  const rightAmount = BigInt(right);
  return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
}

function formatApy(value: number | null): string {
  return value === null ? "APY unavailable" : `${value.toFixed(2)}% APY`;
}

function formatDeposit(raw: string, liquidityMint: string | null): string {
  const amount = BigInt(raw);
  const scale = BigInt(10) ** BigInt(STABLECOIN_DECIMALS);
  const whole = amount / scale;
  const fractional = amount % scale;
  const symbol = getEarnStablecoinSymbol(liquidityMint) ?? "nominal USD";

  return `${whole.toLocaleString("en-US")}.${fractional
    .toString()
    .padStart(STABLECOIN_DECIMALS, "0")
    .slice(0, 2)} ${symbol}`;
}

function formatCompactDeposit(
  raw: string,
  liquidityMint: string | null
): string {
  const amount = Number(BigInt(raw)) / 10 ** STABLECOIN_DECIMALS;
  const symbol = getEarnStablecoinSymbol(liquidityMint) ?? "USD";

  return `${new Intl.NumberFormat("en-US", {
    compactDisplay: "short",
    maximumFractionDigits: 2,
    notation: "compact",
  }).format(amount)} ${symbol}`;
}

function formatUtcTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
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

function toDepositAmount(raw: string): number {
  return Number(BigInt(raw)) / 10 ** STABLECOIN_DECIMALS;
}

function VaultFrequencyTooltip({
  active,
  payload,
  range,
  rangeLabel,
  reserveSeriesByKey,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  range: RangeKey;
  rangeLabel: string;
  reserveSeriesByKey: ReadonlyMap<string, ReserveSeries>;
}) {
  const point = payload?.[0]?.payload;
  const vaultId = point?.vaultId;
  const routeMode = point?.routeMode;
  const [opportunityCounts, setOpportunityCounts] = useState<
    | { data: VaultOpportunityCounts; status: "ready" }
    | { status: "error" | "idle" | "loading" }
  >({ status: "idle" });

  useEffect(() => {
    if (!vaultId || !routeMode) {
      setOpportunityCounts({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ routeMode, vaultId });
    setOpportunityCounts({ status: "loading" });

    void fetch(`/api/earn/rebalance/vault-opportunities?${params}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Vault opportunity request failed: ${response.status}`
          );
        }

        return (await response.json()) as VaultOpportunityCounts;
      })
      .then((data) => setOpportunityCounts({ data, status: "ready" }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setOpportunityCounts({ status: "error" });
        }
      });

    return () => controller.abort();
  }, [routeMode, vaultId]);

  if (!active || !point) {
    return null;
  }

  const opportunityCount =
    opportunityCounts.status === "ready"
      ? range === "all"
        ? opportunityCounts.data.allCount
        : range === "7d"
        ? opportunityCounts.data.last7dCount
        : range === "12h"
        ? opportunityCounts.data.last12hCount
        : opportunityCounts.data.last2hCount
      : null;

  const series = reserveSeriesByKey.get(point.currentReserve ?? NO_RESERVE_KEY);

  return (
    <div className="grid min-w-[18rem] gap-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium font-mono">
        {formatShortAddress(point.vaultPubkey)}
      </div>
      <div className="text-lg font-semibold tabular-nums">
        {point.rebalanceCount.toLocaleString("en-US")} rebalances
      </div>
      <div className="text-muted-foreground">{rangeLabel}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1">
        <dt className="text-muted-foreground">Current deposit</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatDeposit(point.currentDepositRaw, point.liquidityMint)}
        </dd>
        <dt className="text-muted-foreground">Deposit rank</dt>
        <dd className="text-right tabular-nums">{point.depositRank}</dd>
        <dt className="text-muted-foreground">Current reserve</dt>
        <dd className="text-right">{series?.label ?? "No current reserve"}</dd>
        <dt className="text-muted-foreground">Current APY</dt>
        <dd className="text-right tabular-nums">
          {formatApy(series?.apyStatus?.supplyApyPercent ?? null)}
        </dd>
        <dt className="text-muted-foreground">Reserve status</dt>
        <dd className="text-right">
          {series?.apyStatus?.status ?? "No reserve position"}
        </dd>
        <dt className="text-muted-foreground">Opportunities raised</dt>
        <dd className="text-right tabular-nums">
          {opportunityCount === null
            ? opportunityCounts.status === "error"
              ? "Unavailable"
              : "Loading exact count…"
            : opportunityCount.toLocaleString("en-US")}
        </dd>
        <dt className="text-muted-foreground">Positive positions</dt>
        <dd className="text-right tabular-nums">{point.positionCount}</dd>
        <dt className="text-muted-foreground">All / 7d / 12h / 2h</dt>
        <dd className="text-right tabular-nums">
          {point.allCount} / {point.last7dCount} / {point.last12hCount} /{" "}
          {point.last2hCount}
        </dd>
        <dt className="text-muted-foreground">Vault id</dt>
        <dd className="text-right font-mono">{point.vaultId}</dd>
      </dl>
    </div>
  );
}

export function EarnVaultRebalanceFrequencyChart({
  data,
  liquidityMint,
  reserveStatuses,
}: {
  data: SerializedEarnVaultRebalanceFrequency;
  liquidityMint: string | null;
  reserveStatuses: SafeReserveApyStatusRow[];
}) {
  const [range, setRange] = useState<RangeKey>("all");
  const [routeMode, setRouteMode] = useState<RebalanceRouteMode>("same_mint");
  const [scale, setScale] = useState<DepositScale>("log");
  const [showTable, setShowTable] = useState(false);
  const [detailRows, setDetailRows] = useState(data.details);
  const [detailStatus, setDetailStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");

  const rangeOption =
    RANGE_OPTIONS.find((option) => option.key === range) ?? RANGE_OPTIONS[0];
  const rankedVaults = useMemo(
    () =>
      [...data.chartPoints]
        .filter((vault) => vault.routeMode === routeMode)
        .sort((left, right) => {
          const amountOrder = compareRawAmounts(
            left.currentDepositRaw,
            right.currentDepositRaw
          );
          return (
            amountOrder || left.vaultPubkey.localeCompare(right.vaultPubkey)
          );
        }),
    [data.chartPoints, routeMode]
  );
  const points = useMemo(
    () =>
      rankedVaults.map(
        (vault): ChartPoint => ({
          ...vault,
          depositAmount: toDepositAmount(vault.currentDepositRaw),
          rebalanceCount: vault[rangeOption.countKey],
        })
      ),
    [rangeOption.countKey, rankedVaults]
  );
  const apyByReserve = useMemo(
    () => new Map(reserveStatuses.map((status) => [status.reserve, status])),
    [reserveStatuses]
  );
  const reserveSeries = useMemo(() => {
    const reserves = [
      ...new Set(rankedVaults.map((vault) => vault.currentReserve)),
    ];
    return reserves
      .map((reserve) => {
        const status =
          reserve === null ? null : apyByReserve.get(reserve) ?? null;
        return {
          apyStatus: status,
          label:
            reserve === null
              ? "No current reserve"
              : status?.marketName ??
                status?.market ??
                formatShortAddress(reserve),
          reserve,
          reserveKey: reserve ?? NO_RESERVE_KEY,
        };
      })
      .sort((left, right) => {
        if (left.reserve === null) {
          return 1;
        }
        if (right.reserve === null) {
          return -1;
        }
        return left.label.localeCompare(right.label);
      })
      .map(
        (series, index): ReserveSeries => ({
          ...series,
          color:
            series.reserve === null
              ? "var(--muted-foreground)"
              : RESERVE_COLORS[index % RESERVE_COLORS.length],
          key: `reserve${index}`,
        })
      );
  }, [apyByReserve, rankedVaults]);
  const reserveSeriesByKey = useMemo(
    () => new Map(reserveSeries.map((series) => [series.reserveKey, series])),
    [reserveSeries]
  );
  const config = Object.fromEntries(
    reserveSeries.map((series) => [
      series.key,
      { color: series.color, label: series.label },
    ])
  ) satisfies ChartConfig;
  const maxCount = points.reduce(
    (maximum, point) => Math.max(maximum, point.rebalanceCount),
    0
  );
  const tableRows = useMemo(
    () =>
      detailRows
        .filter((vault) => vault.routeMode === routeMode)
        .sort((left, right) => {
          const amountOrder = compareRawAmounts(
            right.currentDepositRaw,
            left.currentDepositRaw
          );
          return (
            amountOrder || right.vaultPubkey.localeCompare(left.vaultPubkey)
          );
        })
        .map(
          (vault): ChartPoint => ({
            ...vault,
            depositAmount: toDepositAmount(vault.currentDepositRaw),
            rebalanceCount: vault[rangeOption.countKey],
          })
        ),
    [detailRows, rangeOption.countKey, routeMode]
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
      const searchParams = new URLSearchParams({ kind: "frequency" });
      if (liquidityMint !== null) {
        searchParams.set("liquidityMint", liquidityMint);
      }
      const response = await fetch(
        `/api/earn/rebalance/details?${searchParams.toString()}`,
        { cache: "no-store", credentials: "same-origin" }
      );
      if (!response.ok) {
        throw new Error(`Vault details request failed: ${response.status}`);
      }
      const result = (await response.json()) as {
        details: SerializedEarnVaultRebalanceFrequencyRow[];
      };
      setDetailRows(result.details);
      setDetailStatus("idle");
      setShowTable(true);
    } catch {
      setDetailStatus("error");
    }
  }
  const summaries = data.summaries.filter(
    (summary) => summary.routeMode === routeMode
  );
  const exactVaultCount = summaries.reduce(
    (total, summary) => total + summary.vaultCount,
    0
  );
  const exactEligibleCount = summaries.reduce(
    (total, summary) =>
      total +
      (range === "all"
        ? summary.eligibleCount
        : range === "7d"
        ? summary.eligibleCount7d
        : range === "12h"
        ? summary.eligibleCount12h
        : summary.eligibleCount2h),
    0
  );
  const exactRebalancedVaultCount = summaries.reduce(
    (total, summary) => total + summary.rebalancedVaultCount,
    0
  );
  const exactRebalanceCount = summaries.reduce(
    (total, summary) =>
      total +
      (range === "all"
        ? summary.rebalanceAllCount
        : range === "7d"
        ? summary.rebalance7dCount
        : range === "12h"
        ? summary.rebalance12hCount
        : summary.rebalance2hCount),
    0
  );
  const primaryLiquidityMint =
    points.find((point) => point.liquidityMint !== null)?.liquidityMint ?? null;
  const eligibilityFloorRaw = computeRebalanceEligibilityFloorRaw(
    reserveStatuses,
    STABLECOIN_DECIMALS
  );
  const positiveDeposits = points
    .map((point) => point.depositAmount)
    .filter((amount) => amount > 0 && Number.isFinite(amount));
  const minDepositAmount =
    positiveDeposits.length > 0 ? Math.min(...positiveDeposits) : 1;
  const maxDepositAmount =
    positiveDeposits.length > 0 ? Math.max(...positiveDeposits) : 1;
  const logTicks = buildLogTicks(minDepositAmount, maxDepositAmount);
  // A log axis has nowhere to put a deposit that rounds to zero, so pin those
  // to the bottom decade instead of dropping the vault off the chart.
  const logFloor = logTicks[0];
  const useLogScale = scale === "log" && positiveDeposits.length > 0;
  const zeroDepositCount = points.length - positiveDeposits.length;
  const scatterPoints = points.map((point) => ({
    ...point,
    plottedDeposit: point.depositAmount > 0 ? point.depositAmount : logFloor,
  }));

  if (data.status === "unavailable") {
    return (
      <Card
        className="min-w-0"
        aria-labelledby="vault-rebalance-frequency-title"
      >
        <CardHeader>
          <CardTitle id="vault-rebalance-frequency-title">
            Earn vault rebalance frequency
          </CardTitle>
          <CardDescription>
            Vault-level frequency is temporarily unavailable. The other Earn
            rebalance monitors remain independent and available.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="min-w-0" aria-labelledby="vault-rebalance-frequency-title">
      <Tabs
        className="gap-6"
        value={range}
        onValueChange={(value) => setRange(value as RangeKey)}
      >
        <CardHeader className="gap-3">
          <div>
            <CardTitle id="vault-rebalance-frequency-title">
              Earn vault rebalance frequency
            </CardTitle>
            <CardDescription>
              One dot per funded active{" "}
              {routeMode === "cross_mint" ? "Crossmint-enrolled" : "Earn"}{" "}
              vault. X is the current deposit, on a log or linear scale; Y shows
              confirmed {routeMode === "cross_mint" ? "Crossmint" : "same-mint"}{" "}
              rebalances in the selected window. Dot color is the largest
              current reserve position. Vaults below the eligibility floor
              cannot clear the planner&rsquo;s economic gate, so they sit at
              zero by design.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RouteModeSwitch
              id="vault-rebalance-frequency-route-mode"
              mode={routeMode}
              onModeChange={setRouteMode}
            />
            {points.length > 0 ? (
              <>
                <TabsList
                  aria-label="Vault rebalance frequency window"
                  className="w-fit max-w-full"
                >
                  {RANGE_OPTIONS.map((option) => (
                    <TabsTrigger key={option.key} value={option.key}>
                      {option.tabLabel}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <DepositScaleSwitch
                  id="vault-rebalance-frequency-scale"
                  onScaleChange={setScale}
                  scale={scale}
                />
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
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {points.length === 0 ? null : eligibilityFloorRaw === null ? (
              <span>
                {exactRebalancedVaultCount.toLocaleString("en-US")} of{" "}
                {exactEligibleCount.toLocaleString("en-US")} funded vaults
                rebalanced
              </span>
            ) : (
              <span className="text-foreground">
                {exactRebalancedVaultCount.toLocaleString("en-US")} of{" "}
                {exactEligibleCount.toLocaleString("en-US")} economically
                eligible vaults rebalanced
              </span>
            )}
            {points.length > 0 ? (
              <span>
                {exactVaultCount.toLocaleString("en-US")} funded vaults ·{" "}
                {exactRebalancedVaultCount.toLocaleString("en-US")} with
                rebalances
              </span>
            ) : null}
            {points.length === 0 || eligibilityFloorRaw === null ? null : (
              <span>
                Eligible at{" "}
                {formatDeposit(
                  eligibilityFloorRaw.toString(),
                  primaryLiquidityMint
                )}
                +
              </span>
            )}
            {points.length > 0 ? (
              <span>
                {exactRebalanceCount.toLocaleString("en-US")} confirmed
                executions · {rangeOption.label}
              </span>
            ) : null}
            <span>Updated {formatUtcTimestamp(data.generatedAt)}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {reserveSeries.map((series) => (
              <span
                className="inline-flex items-center gap-1.5"
                key={series.key}
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                {series.label} ·{" "}
                {formatApy(series.apyStatus?.supplyApyPercent ?? null)}
              </span>
            ))}
          </div>
        </CardHeader>
        {RANGE_OPTIONS.map((option) => (
          <TabsContent className="mt-0" key={option.key} value={option.key}>
            {range === option.key ? (
              <CardContent className="min-w-0">
                {points.length === 0 ? (
                  <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    {routeMode === "cross_mint"
                      ? "No active Earn vaults have Crossmint enabled."
                      : "No funded active Earn vaults are available."}
                  </div>
                ) : showTable ? (
                  <div className="max-h-[460px] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead className="text-right">
                            Deposit rank
                          </TableHead>
                          <TableHead>Vault</TableHead>
                          <TableHead>Mint</TableHead>
                          <TableHead>Current reserve</TableHead>
                          <TableHead className="text-right">
                            Current APY
                          </TableHead>
                          <TableHead className="text-right">
                            Current deposit
                          </TableHead>
                          <TableHead className="text-right">All</TableHead>
                          <TableHead className="text-right">7d</TableHead>
                          <TableHead className="text-right">12h</TableHead>
                          <TableHead className="text-right">2h</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRows.map((point) => {
                          const series = reserveSeriesByKey.get(
                            point.currentReserve ?? NO_RESERVE_KEY
                          );
                          return (
                            <TableRow key={point.vaultId}>
                              <TableCell className="text-right tabular-nums">
                                {point.depositRank}
                              </TableCell>
                              <TableCell className="whitespace-nowrap font-mono">
                                {formatShortAddress(point.vaultPubkey)}
                              </TableCell>
                              <TableCell className="font-medium">
                                {getEarnStablecoinSymbol(point.liquidityMint) ??
                                  "Unknown"}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {series?.label ?? "No current reserve"}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap tabular-nums">
                                {formatApy(
                                  series?.apyStatus?.supplyApyPercent ?? null
                                )}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap tabular-nums">
                                {formatDeposit(
                                  point.currentDepositRaw,
                                  point.liquidityMint
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {point.allCount}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {point.last7dCount}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {point.last12hCount}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {point.last2hCount}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <ChartContainer
                    className="aspect-auto h-[420px] w-full min-w-0"
                    config={config}
                  >
                    <ScatterChart
                      accessibilityLayer
                      margin={{ bottom: 16, left: 8, right: 16, top: 12 }}
                    >
                      <CartesianGrid />
                      {useLogScale ? (
                        <XAxis
                          allowDataOverflow
                          axisLine={false}
                          dataKey="plottedDeposit"
                          domain={[
                            logTicks[0],
                            logTicks[logTicks.length - 1] ?? 1,
                          ]}
                          name="Current deposit amount"
                          scale="log"
                          tickFormatter={(amount: number) =>
                            formatDepositTick(amount, primaryLiquidityMint)
                          }
                          tickLine={false}
                          tickMargin={8}
                          ticks={logTicks}
                          type="number"
                        />
                      ) : (
                        <XAxis
                          axisLine={false}
                          dataKey="depositAmount"
                          domain={[0, Math.max(maxDepositAmount, 1)]}
                          name="Current deposit amount"
                          tickFormatter={(amount: number) =>
                            formatDepositTick(amount, primaryLiquidityMint)
                          }
                          tickLine={false}
                          tickMargin={8}
                          type="number"
                        />
                      )}
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        dataKey="rebalanceCount"
                        domain={[0, Math.max(maxCount, 1)]}
                        name="Confirmed rebalances"
                        tickLine={false}
                        width={48}
                      />
                      <ZAxis range={[22, 22]} />
                      <ChartTooltip
                        content={
                          <VaultFrequencyTooltip
                            range={range}
                            rangeLabel={rangeOption.label}
                            reserveSeriesByKey={reserveSeriesByKey}
                          />
                        }
                        cursor={{ strokeDasharray: "3 3" }}
                      />
                      {reserveSeries.map((series) => (
                        <Scatter
                          data={scatterPoints.filter(
                            (point) =>
                              (point.currentReserve ?? NO_RESERVE_KEY) ===
                              series.reserveKey
                          )}
                          fill={`var(--color-${series.key})`}
                          key={series.key}
                          name={series.label}
                        />
                      ))}
                    </ScatterChart>
                  </ChartContainer>
                )}
                {points.length > 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {maxCount === 0
                      ? "No confirmed rebalances occurred in this window; every vault is shown at zero."
                      : "Hover a dot for the exact vault, current deposit, reserve APY, and counts for every window."}
                    {showTable
                      ? " The table shows the exact top 100 current deposits."
                      : " Idle-only vaults use the neutral legend color."}
                    {!showTable && useLogScale && zeroDepositCount > 0
                      ? ` ${zeroDepositCount.toLocaleString("en-US")} vault${
                          zeroDepositCount === 1 ? "" : "s"
                        } with a zero deposit sit on the axis floor.`
                      : ""}
                  </p>
                ) : null}
              </CardContent>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
