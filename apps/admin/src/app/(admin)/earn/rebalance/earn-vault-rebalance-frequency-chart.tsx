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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getEarnStablecoinSymbol,
  STABLECOIN_DECIMALS,
} from "@/lib/earn/stablecoin-monitor.shared";
import type { SafeReserveApyStatusRow } from "@/lib/kamino/timescale-reserve-monitor.shared";

import { buildLogTicks, formatLogTick } from "./earn-vault-rebalance-axis";
import {
  computeRebalanceEligibilityFloorRaw,
  summarizeRebalanceEligibility,
} from "./earn-vault-rebalance-eligibility";

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
  vaultId: string;
  vaultPubkey: string;
};

export type SerializedEarnVaultRebalanceFrequency = {
  generatedAt: string;
  status: "available" | "unavailable";
  vaultCount: number;
  vaults: SerializedEarnVaultRebalanceFrequencyRow[];
};

type RangeKey = "12h" | "2h" | "7d" | "all";
type CountKey = "allCount" | "last7dCount" | "last12hCount" | "last2hCount";
type ScaleKey = "linear" | "log";

type ChartPoint = SerializedEarnVaultRebalanceFrequencyRow & {
  depositAmount: number;
  depositRank: number;
  rebalanceCount: number;
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
  { countKey: "allCount", key: "all", label: "All history", tabLabel: "All" },
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

const SCALE_OPTIONS: ReadonlyArray<{
  key: ScaleKey;
  label: string;
}> = [
  { key: "log", label: "Log scale" },
  { key: "linear", label: "As is" },
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

function buildRankTicks(vaultCount: number): number[] {
  const tickCount = Math.min(7, Math.max(vaultCount, 1));
  return Array.from(
    new Set(
      Array.from({ length: tickCount }, (_, index) =>
        Math.max(
          1,
          Math.round(
            1 +
              (index * Math.max(vaultCount - 1, 0)) / Math.max(tickCount - 1, 1)
          )
        )
      )
    )
  );
}

function VaultFrequencyTooltip({
  active,
  payload,
  rangeLabel,
  reserveSeriesByKey,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  rangeLabel: string;
  reserveSeriesByKey: ReadonlyMap<string, ReserveSeries>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

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
  reserveStatuses,
}: {
  data: SerializedEarnVaultRebalanceFrequency;
  reserveStatuses: SafeReserveApyStatusRow[];
}) {
  const [range, setRange] = useState<RangeKey>("all");
  const [scale, setScale] = useState<ScaleKey>("log");
  const [showTable, setShowTable] = useState(false);

  const rangeOption =
    RANGE_OPTIONS.find((option) => option.key === range) ?? RANGE_OPTIONS[0];
  const rankedVaults = useMemo(
    () =>
      [...data.vaults]
        .sort((left, right) => {
          const amountOrder = compareRawAmounts(
            left.currentDepositRaw,
            right.currentDepositRaw
          );
          return (
            amountOrder || left.vaultPubkey.localeCompare(right.vaultPubkey)
          );
        })
        .map((vault, index) => ({
          ...vault,
          depositRank: index + 1,
        })),
    [data.vaults]
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
  const vaultByRank = new Map(
    points.map((point) => [point.depositRank, point])
  );
  const rankTicks = buildRankTicks(points.length);
  const maxCount = points.reduce(
    (maximum, point) => Math.max(maximum, point.rebalanceCount),
    0
  );
  const rebalancedVaultCount = points.filter(
    (point) => point.rebalanceCount > 0
  ).length;
  const totalRebalances = points.reduce(
    (total, point) => total + point.rebalanceCount,
    0
  );
  const tableRows = [...points].reverse().slice(0, 100);
  const primaryLiquidityMint =
    points.find((point) => point.liquidityMint !== null)?.liquidityMint ?? null;
  const eligibilityFloorRaw = computeRebalanceEligibilityFloorRaw(
    reserveStatuses,
    STABLECOIN_DECIMALS
  );
  const { eligibleCount, eligibleRebalancedCount } =
    summarizeRebalanceEligibility(points, eligibilityFloorRaw);
  const positiveDeposits = points
    .map((point) => point.depositAmount)
    .filter((amount) => amount > 0 && Number.isFinite(amount));
  const minDepositAmount =
    positiveDeposits.length > 0 ? Math.min(...positiveDeposits) : 1;
  const maxDepositAmount =
    positiveDeposits.length > 0 ? Math.max(...positiveDeposits) : 1;
  const logTicks = buildLogTicks(minDepositAmount, maxDepositAmount);
  // A log axis cannot place a zero or rounded-to-zero deposit, so fall back to
  // the rank axis rather than dropping those vaults from the chart.
  const useLogScale =
    scale === "log" && positiveDeposits.length === points.length;

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
        value={range}
        onValueChange={(value) => setRange(value as RangeKey)}
      >
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle id="vault-rebalance-frequency-title">
                Earn vault rebalance frequency
              </CardTitle>
              <CardDescription>
                One dot per funded active vault. X is the current deposit on a
                log scale, or ordered smallest to largest under &ldquo;As
                is&rdquo;; Y shows confirmed reserve-to-reserve rebalances in the
                selected window. Dot color is the largest current reserve
                position. Vaults below the eligibility floor cannot clear the
                planner&rsquo;s economic gate, so they sit at zero by design.
              </CardDescription>
            </div>
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
          <div className="flex flex-wrap items-center gap-3">
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
            <div
              aria-label="Deposit axis scale"
              className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1"
              role="group"
            >
              {SCALE_OPTIONS.map((option) => (
                <Button
                  aria-pressed={scale === option.key}
                  className="h-7 px-3 text-xs"
                  key={option.key}
                  onClick={() => setScale(option.key)}
                  size="sm"
                  type="button"
                  variant={scale === option.key ? "secondary" : "ghost"}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {eligibilityFloorRaw === null ? (
              <span>
                {rebalancedVaultCount.toLocaleString("en-US")} of{" "}
                {points.length.toLocaleString("en-US")} funded vaults rebalanced
              </span>
            ) : (
              <span className="text-foreground">
                {eligibleRebalancedCount.toLocaleString("en-US")} of{" "}
                {eligibleCount.toLocaleString("en-US")} economically eligible
                vaults rebalanced
              </span>
            )}
            <span>
              {points.length.toLocaleString("en-US")} funded vaults ·{" "}
              {rebalancedVaultCount.toLocaleString("en-US")} with rebalances
            </span>
            {eligibilityFloorRaw === null ? null : (
              <span>
                Eligible at{" "}
                {formatDeposit(
                  eligibilityFloorRaw.toString(),
                  primaryLiquidityMint
                )}
                +
              </span>
            )}
            <span>
              {totalRebalances.toLocaleString("en-US")} confirmed executions ·{" "}
              {rangeOption.label}
            </span>
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
                  <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    No funded active Earn vaults are available.
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
                          dataKey="depositAmount"
                          domain={[
                            logTicks[0],
                            logTicks[logTicks.length - 1] ?? 1,
                          ]}
                          name="Current deposit amount"
                          scale="log"
                          tickFormatter={(amount: number) =>
                            formatLogTick(amount, primaryLiquidityMint)
                          }
                          tickLine={false}
                          tickMargin={8}
                          ticks={logTicks}
                          type="number"
                        />
                      ) : (
                        <XAxis
                          allowDecimals={false}
                          axisLine={false}
                          dataKey="depositRank"
                          domain={[1, Math.max(points.length, 1)]}
                          name="Current deposit amount"
                          tickFormatter={(rank: number) => {
                            const vault = vaultByRank.get(rank);
                            return vault
                              ? formatCompactDeposit(
                                  vault.currentDepositRaw,
                                  vault.liquidityMint
                                )
                              : `#${rank}`;
                          }}
                          tickLine={false}
                          tickMargin={8}
                          ticks={rankTicks}
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
                            rangeLabel={rangeOption.label}
                            reserveSeriesByKey={reserveSeriesByKey}
                          />
                        }
                        cursor={{ strokeDasharray: "3 3" }}
                      />
                      {reserveSeries.map((series) => (
                        <Scatter
                          data={points.filter(
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
                <p className="mt-3 text-xs text-muted-foreground">
                  {maxCount === 0
                    ? "No confirmed rebalances occurred in this window; every vault is shown at zero."
                    : "Hover a dot for the exact vault, current deposit, reserve APY, and counts for every window."}
                  {showTable
                    ? " The table shows the 100 largest current deposits."
                    : " Idle-only vaults use the neutral legend color."}
                  {!showTable && scale === "log" && !useLogScale
                    ? " Some deposits round to zero, so the log axis fell back to deposit order."
                    : ""}
                </p>
              </CardContent>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
