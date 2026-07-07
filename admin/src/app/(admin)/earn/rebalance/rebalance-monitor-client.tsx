"use client";

import { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import {
  AddressLink,
  formatShortAddress,
  SolscanTransactionLink,
} from "@/components/blockchain/address-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  SafeReserveApyMonitorData,
  SafeReserveApyStatusRow,
  SafeReserveRebalanceDecisionMarker,
} from "@/lib/kamino/timescale-reserve-monitor.shared";

import {
  CollapsibleReasonCell,
  SafeReserveApyChart,
} from "../safe-reserve-apy-chart";
import type {
  EarnActiveReserveRouteRow,
  EarnRebalanceDecisionRow,
} from "./rebalance-data";

const USDC_DECIMALS = 6;
const SOLANA_ENV = "mainnet";

type SerializedActiveReserveRouteRow = Omit<
  EarnActiveReserveRouteRow,
  "activeAumRaw"
> & {
  activeAumRaw: string;
};

type SerializedRebalanceDecisionRow = Omit<
  EarnRebalanceDecisionRow,
  "amountRaw" | "confirmedSlot"
> & {
  amountRaw: string | null;
  confirmedSlot: string | null;
};

type RebalanceApiData = {
  apyData: SafeReserveApyMonitorData;
  decisions: SerializedRebalanceDecisionRow[];
  routes: SerializedActiveReserveRouteRow[];
};

type LoadState =
  | { status: "loading" }
  | { data: RebalanceApiData; status: "ready" }
  | { message: string; status: "error" };

type ApySortDirection = "asc" | "desc";

function formatCompactUsdcRaw(raw: bigint | string) {
  const parsedRaw = typeof raw === "bigint" ? raw : BigInt(raw);
  const zero = BigInt(0);
  const centScale = BigInt(10) ** BigInt(USDC_DECIMALS - 2);
  const sign = parsedRaw < zero ? "-" : "";
  const absolute = parsedRaw < zero ? -parsedRaw : parsedRaw;
  const roundedCents = (absolute + centScale / BigInt(2)) / centScale;
  const whole = roundedCents / BigInt(100);
  const cents = roundedCents % BigInt(100);
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign}${wholeText}.${cents.toString().padStart(2, "0")} USDC`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "No data";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatApyPercent(value: number | null) {
  return value === null ? "No data" : `${value.toFixed(2)}%`;
}

function formatCompactUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "No data";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function formatBps(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "No data";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US")} bps`;
}

function formatBpsAsApyPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "No data";
  }

  return `${(value / 100).toFixed(2)}%`;
}

function formatReason(value: string | null) {
  if (!value) {
    return "No reason";
  }

  return value.replaceAll("_", " ");
}

function formatDecisionType(
  value: SerializedRebalanceDecisionRow["decisionType"]
) {
  switch (value) {
    case "autodeposit":
      return "Autodeposit";
    case "rebalance":
      return "Rebalance";
    default:
      return "N/A";
  }
}

function createReserveLabelMap(data: SafeReserveApyMonitorData) {
  return new Map(
    data.statuses.map((row) => [
      row.reserve,
      row.marketName ?? row.market ?? formatShortAddress(row.reserve),
    ])
  );
}

function getReserveLabel(
  labels: ReadonlyMap<string, string>,
  reserve: string | null
) {
  if (!reserve) {
    return "No reserve";
  }

  return labels.get(reserve) ?? formatShortAddress(reserve);
}

function toDecisionMarkers(
  rows: readonly SerializedRebalanceDecisionRow[]
): SafeReserveRebalanceDecisionMarker[] {
  return rows.map((row) => ({
    createdAt: row.createdAt,
    estimatedEdgeBps: row.estimatedEdgeBps,
    id: row.id,
    sourceApyBps: row.sourceApyBps,
    sourceReserve: row.sourceReserve,
    status: row.status,
    targetApyBps: row.targetApyBps,
    targetReserve: row.targetReserve,
  }));
}

function CurrentReserveApyTable({
  routes,
  rows,
}: {
  routes: SerializedActiveReserveRouteRow[];
  rows: SafeReserveApyStatusRow[];
}) {
  const [apySortDirection, setApySortDirection] =
    useState<ApySortDirection>("desc");
  const apyAriaSort = apySortDirection === "desc" ? "descending" : "ascending";
  const ApySortIcon = apySortDirection === "desc" ? ArrowDownIcon : ArrowUpIcon;
  const routeByReserve = new Map(
    routes.map((route) => [route.currentReserve, route])
  );
  const sortedRows = rows.slice().sort((left, right) => {
    const leftApy = left.supplyApyPercent;
    const rightApy = right.supplyApyPercent;

    if (leftApy === null && rightApy !== null) {
      return 1;
    }

    if (leftApy !== null && rightApy === null) {
      return -1;
    }

    if (leftApy !== null && rightApy !== null && leftApy !== rightApy) {
      return apySortDirection === "desc"
        ? rightApy - leftApy
        : leftApy - rightApy;
    }

    return (left.marketName ?? left.market).localeCompare(
      right.marketName ?? right.market,
      "en-US"
    );
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead className="text-right" aria-sort={apyAriaSort}>
            <Button
              className="h-auto justify-end gap-1 px-0 py-0 font-medium"
              onClick={() =>
                setApySortDirection((direction) =>
                  direction === "desc" ? "asc" : "desc"
                )
              }
              type="button"
              variant="ghost"
            >
              <span>APY</span>
              <ApySortIcon aria-hidden="true" className="size-3.5" />
            </Button>
          </TableHead>
          <TableHead className="text-right">24h Avg</TableHead>
          <TableHead className="text-right">7d Avg</TableHead>
          <TableHead className="text-right">Supply</TableHead>
          <TableHead className="text-right">Route</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((row) => {
          const route = routeByReserve.get(row.reserve);

          return (
            <TableRow key={row.reserve}>
              <TableCell className="font-medium">
                <div>{row.marketName ?? row.market}</div>
                <div className="mt-1 text-xs font-normal text-muted-foreground">
                  <AddressLink address={row.reserve} solanaEnv={SOLANA_ENV} />
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatApyPercent(row.supplyApyPercent)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatApyPercent(row.average24hApyPercent)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatApyPercent(row.average7dApyPercent)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCompactUsd(row.totalSupplyUsdEstimate)}
              </TableCell>
              <TableCell className="text-right">
                {route ? (
                  <div className="inline-flex flex-col items-end gap-1">
                    <Badge variant="outline">Current</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatCompactUsdcRaw(route.activeAumRaw)}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">No</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function RebalanceDecisionAuditTable({
  decisions,
  reserveLabels,
}: {
  decisions: SerializedRebalanceDecisionRow[];
  reserveLabels: ReadonlyMap<string, string>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Current</TableHead>
          <TableHead>Best</TableHead>
          <TableHead className="text-right">Current APY</TableHead>
          <TableHead className="text-right">Best APY</TableHead>
          <TableHead className="text-right">Delta</TableHead>
          <TableHead className="text-right">Action</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead className="text-right">Tx</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {decisions.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={10}>
              No rebalance decisions found.
            </TableCell>
          </TableRow>
        ) : (
          decisions.map((decision) => (
            <TableRow key={decision.id}>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatDateTime(decision.createdAt)}
              </TableCell>
              <TableCell>{formatDecisionType(decision.decisionType)}</TableCell>
              <TableCell>
                {getReserveLabel(reserveLabels, decision.sourceReserve)}
              </TableCell>
              <TableCell>
                {getReserveLabel(reserveLabels, decision.targetReserve)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatBpsAsApyPercent(decision.sourceApyBps)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatBpsAsApyPercent(decision.targetApyBps)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatBps(decision.estimatedEdgeBps)}
              </TableCell>
              <TableCell className="text-right">
                <Badge
                  variant={
                    decision.status === "confirmed" ? "outline" : "secondary"
                  }
                >
                  {formatReason(decision.status)}
                </Badge>
              </TableCell>
              <TableCell>
                <CollapsibleReasonCell
                  reason={formatReason(
                    decision.abandonReason ?? decision.decisionReason
                  )}
                />
              </TableCell>
              <TableCell className="text-right">
                {decision.signature ? (
                  <SolscanTransactionLink
                    signature={decision.signature}
                    solanaEnv={SOLANA_ENV}
                  >
                    {formatShortAddress(decision.signature)}
                  </SolscanTransactionLink>
                ) : (
                  <span className="text-muted-foreground">No tx</span>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function CurrentReserveApyCard({
  routes,
  rows,
}: {
  routes: SerializedActiveReserveRouteRow[];
  rows: SafeReserveApyStatusRow[];
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="font-bold">Current Safe reserve APY</CardTitle>
        <CardDescription>Active USDC Safe basket reserves</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 overflow-x-auto">
        <CurrentReserveApyTable routes={routes} rows={rows} />
      </CardContent>
    </Card>
  );
}

function RebalanceDecisionAuditCard({
  decisions,
  reserveLabels,
}: {
  decisions: SerializedRebalanceDecisionRow[];
  reserveLabels: ReadonlyMap<string, string>;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="font-bold">Rebalance decision audit</CardTitle>
        <CardDescription>
          Recent optimizer turns with the source reserve, selected target, APY
          edge, reason, and transaction status
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 overflow-x-auto">
        <RebalanceDecisionAuditTable
          decisions={decisions}
          reserveLabels={reserveLabels}
        />
      </CardContent>
    </Card>
  );
}

function CurrentReserveApyFallback() {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-3"
            key={index}
          >
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ApyChartFallback() {
  return (
    <Card className="mx-auto w-full max-w-4xl">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-6 sm:p-6">
        <Skeleton className="h-[300px] w-full" />
        <div className="mt-4 flex flex-wrap gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton className="h-4 w-28" key={index} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RebalanceDecisionAuditFallback() {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr_1.6fr] gap-3"
            key={index}
          >
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RebalanceMonitorFallback() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <CurrentReserveApyFallback />
      <ApyChartFallback />
      <RebalanceDecisionAuditFallback />
    </div>
  );
}

export function RebalanceMonitorClient() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function loadMonitor() {
      try {
        const response = await fetch("/api/earn/rebalance", {
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Rebalance monitor request failed: ${response.status}`
          );
        }

        const data = (await response.json()) as RebalanceApiData;
        setState({ data, status: "ready" });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          message:
            error instanceof Error
              ? error.message
              : "Rebalance monitor request failed.",
          status: "error",
        });
      }
    }

    void loadMonitor();

    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return <RebalanceMonitorFallback />;
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="font-bold">Rebalance monitor</CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const reserveLabels = createReserveLabelMap(state.data.apyData);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <CurrentReserveApyCard
        routes={state.data.routes}
        rows={state.data.apyData.statuses}
      />
      <SafeReserveApyChart
        data={state.data.apyData}
        decisionMarkers={toDecisionMarkers(state.data.decisions)}
      />
      <RebalanceDecisionAuditCard
        decisions={state.data.decisions}
        reserveLabels={reserveLabels}
      />
    </div>
  );
}
