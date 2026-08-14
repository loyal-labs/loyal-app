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
  sourceReserve: string;
  targetReserve: string;
  userRank: number;
};

export type SerializedExecutedEarnRebalanceHistory = {
  executions: SerializedExecutedEarnRebalanceRow[];
  generatedAt: string;
  status: "available" | "unavailable";
  userCount: number;
};

type ChartPoint = SerializedExecutedEarnRebalanceRow & {
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
          {formatStablecoinRaw(point.amountRaw, point.liquidityMint)}
        </dd>
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
  const [showTable, setShowTable] = useState(false);

  const points = useMemo(
    () =>
      data.executions
        .map((execution) => ({
          ...execution,
          executedAtMs: Date.parse(execution.executedAt),
        }))
        .filter((execution) => Number.isFinite(execution.executedAtMs)),
    [data.executions]
  );

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

  const userByRank = new Map(
    points.map((point) => [
      point.userRank,
      {
        authority: point.authority,
        currentDepositRaw: point.currentDepositRaw,
      },
    ])
  );
  const yTicks = Array.from(
    new Set(
      Array.from(
        { length: Math.min(7, Math.max(data.userCount, 1)) },
        (_, index) =>
          Math.max(
            1,
            Math.round(
              1 +
                (index * Math.max(data.userCount - 1, 0)) /
                  Math.max(Math.min(7, data.userCount) - 1, 1)
            )
          )
      )
    )
  );
  const tableRows = [...filteredPoints].reverse().slice(0, 50);

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
              One dot per confirmed reserve-to-reserve decision. Users are
              ordered by their current Earn deposit, smallest at the bottom and
              largest at the top. Times are UTC.
            </CardDescription>
          </div>
          <div
            className="flex flex-wrap gap-1"
            aria-label="Execution history range"
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
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            {data.executions.length.toLocaleString("en-US")} confirmed
            executions
          </span>
          <span>{data.userCount.toLocaleString("en-US")} distinct users</span>
          <span>
            {filteredPoints.length.toLocaleString("en-US")} shown ·{" "}
            {rangeLabel(range)}
          </span>
          <span>Updated {formatUtcTimestamp(data.generatedAt)}</span>
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
            No confirmed Earn rebalances are available.
          </div>
        ) : showTable ? (
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Executed (UTC)</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Mint</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead className="text-right">Confirmed slot</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
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
                    <TableCell className="font-medium">
                      {getEarnStablecoinSymbol(point.liquidityMint) ??
                        "Unknown"}
                    </TableCell>
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
                        point.liquidityMint
                      )}
                    </TableCell>
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
              <YAxis
                allowDecimals={false}
                axisLine={false}
                dataKey="userRank"
                domain={[1, Math.max(data.userCount, 1)]}
                name="User ordered by current deposit"
                tickFormatter={(rank: number) => {
                  const user = userByRank.get(rank);
                  return user ? formatShortAddress(user.authority) : `#${rank}`;
                }}
                tickLine={false}
                ticks={yTicks}
                type="number"
                width={78}
              />
              <ZAxis range={[18, 18]} />
              <ChartTooltip
                content={
                  <ExecutedRebalanceTooltip reserveLabels={reserveLabels} />
                }
                cursor={{ strokeDasharray: "3 3" }}
              />
              {sources.map((source) => (
                <Scatter
                  data={filteredPoints.filter(
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
            Y-axis labels sample the ordered user ranks; hover a dot for the
            exact wallet, current deposit, route, amount, decision, and slot.
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the 50 most recent executions in the selected range.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
