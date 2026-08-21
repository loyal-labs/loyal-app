"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, RefreshCwIcon } from "lucide-react";

import {
  AddressLink,
  formatShortAddress,
  OrbTransactionLink,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EARN_STABLECOIN_DESCRIPTORS,
  getEarnStablecoinSymbol,
  STABLECOIN_DECIMALS,
} from "@/lib/earn/stablecoin-monitor.shared";
import type {
  SafeReserveApyMonitorData,
  SafeReserveApyStatusRow,
  SafeReserveRebalanceDecisionMarker,
} from "@/lib/kamino/timescale-reserve-monitor.shared";

import { SafeReserveApyChart } from "../safe-reserve-apy-chart";
import {
  AutodepositFailuresChart,
  type SerializedAutodepositFailureRange,
} from "./autodeposit-failures-chart";
import {
  EarnVaultRebalanceFrequencyChart,
  type SerializedEarnVaultRebalanceFrequency,
} from "./earn-vault-rebalance-frequency-chart";
import {
  ExecutedEarnRebalancesChart,
  type SerializedExecutedEarnRebalanceHistory,
} from "./executed-earn-rebalances-chart";
import { Last30DaysRebalanceChart } from "./last-30-days-rebalance-chart";
import { RebalanceActivityChart } from "./rebalance-activity-chart";
import type {
  EarnActiveReserveRouteRow,
  EarnRebalanceDecisionRow,
  Last30DaysRebalancePoint,
  RebalanceActivityPoint,
  RebalanceAuditErrorFilter,
  RebalanceAuditLane,
  RebalanceAuditRange,
  RebalanceAuditRow,
  RebalanceAuditSource,
  RebalanceAuditSummary,
  RebalanceAuditView,
  RebalanceRouteMode,
} from "./rebalance-data";
import { RouteModeSwitch } from "./route-mode-switch";

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

type SerializedRebalanceAuditRow = Omit<
  RebalanceAuditRow,
  "amountRaw" | "confirmedSlot" | "submittedSlot"
> & {
  amountRaw: string | null;
  confirmedSlot: string | null;
  submittedSlot: string | null;
};

type SerializedRebalanceActivityPoint = Omit<
  RebalanceActivityPoint,
  "maxSwapFeeLamports" | "swapFeeLamports"
> & {
  maxSwapFeeLamports: string;
  swapFeeLamports: string;
};

type RebalanceApiData = {
  activity: SerializedRebalanceActivityPoint[];
  apyData: SafeReserveApyMonitorData;
  autodeposit: SerializedAutodepositFailureRange[];
  decisions: SerializedRebalanceDecisionRow[];
  executedRebalances: SerializedExecutedEarnRebalanceHistory;
  initialAudit: AuditApiData;
  last30DaysRebalances: Last30DaysRebalancePoint[];
  routes: SerializedActiveReserveRouteRow[];
  vaultRebalanceFrequency: SerializedEarnVaultRebalanceFrequency;
};

type SerializedSafeReserveApyMonitorData = Omit<
  SafeReserveApyMonitorData,
  "chartPoints"
> & {
  observedAtMs: number[];
  values: Array<Array<number | null>>;
};

type SerializedExecutedRebalanceTuple = readonly [
  amountRaw: string,
  authorityIndex: number,
  confirmedSlot: string,
  currentDepositRaw: string,
  executedAt: string,
  id: string,
  liquidityMintIndex: number | null,
  routeMode: RebalanceRouteMode,
  sourceReserveIndex: number,
  sourceLiquidityMintIndex: number | null,
  swapFeeLamports: string,
  targetReserveIndex: number,
  targetLiquidityMintIndex: number | null,
  userRank: number
];

type SerializedVaultFrequencyTuple = readonly [
  allCount: number,
  currentDepositRaw: string,
  currentReserve: string | null,
  depositRank: number,
  last12hCount: number,
  last2hCount: number,
  last7dCount: number,
  liquidityMint: string | null,
  positionCount: number,
  routeMode: RebalanceRouteMode,
  vaultId: string,
  vaultPubkey: string
];

type RebalanceApiWireData = Omit<
  RebalanceApiData,
  "apyData" | "executedRebalances" | "vaultRebalanceFrequency"
> & {
  apyData: SerializedSafeReserveApyMonitorData;
  executedRebalances: Omit<
    SerializedExecutedEarnRebalanceHistory,
    "chartPoints" | "details"
  > & {
    chartPoints: ReadonlyArray<SerializedExecutedRebalanceTuple>;
    details: ReadonlyArray<SerializedExecutedRebalanceTuple>;
    strings: string[];
  };
  vaultRebalanceFrequency: Omit<
    SerializedEarnVaultRebalanceFrequency,
    "chartPoints" | "details"
  > & {
    chartPoints: ReadonlyArray<SerializedVaultFrequencyTuple>;
    details: ReadonlyArray<SerializedVaultFrequencyTuple>;
  };
};

function deserializeExecutedRebalance(
  [
    amountRaw,
    authorityIndex,
    confirmedSlot,
    currentDepositRaw,
    executedAt,
    id,
    liquidityMintIndex,
    routeMode,
    sourceReserveIndex,
    sourceLiquidityMintIndex,
    swapFeeLamports,
    targetReserveIndex,
    targetLiquidityMintIndex,
    userRank,
  ]: SerializedExecutedRebalanceTuple,
  strings: readonly string[]
): SerializedExecutedEarnRebalanceHistory["chartPoints"][number] {
  return {
    amountRaw,
    authority: strings[authorityIndex] ?? "",
    confirmedSlot,
    currentDepositRaw,
    executedAt,
    id,
    liquidityMint:
      liquidityMintIndex === null ? null : strings[liquidityMintIndex] ?? null,
    routeMode,
    sourceLiquidityMint:
      sourceLiquidityMintIndex === null
        ? null
        : strings[sourceLiquidityMintIndex] ?? null,
    sourceReserve: strings[sourceReserveIndex] ?? "",
    swapFeeLamports,
    targetLiquidityMint:
      targetLiquidityMintIndex === null
        ? null
        : strings[targetLiquidityMintIndex] ?? null,
    targetReserve: strings[targetReserveIndex] ?? "",
    userRank,
  };
}

function deserializeVaultFrequency([
  allCount,
  currentDepositRaw,
  currentReserve,
  depositRank,
  last12hCount,
  last2hCount,
  last7dCount,
  liquidityMint,
  positionCount,
  routeMode,
  vaultId,
  vaultPubkey,
]: SerializedVaultFrequencyTuple): SerializedEarnVaultRebalanceFrequency["chartPoints"][number] {
  return {
    allCount,
    currentDepositRaw,
    currentReserve,
    depositRank,
    last12hCount,
    last2hCount,
    last7dCount,
    liquidityMint,
    positionCount,
    routeMode,
    vaultId,
    vaultPubkey,
  };
}

function deserializeApyData(
  data: SerializedSafeReserveApyMonitorData
): SafeReserveApyMonitorData {
  return {
    chartPoints: data.observedAtMs.map((observedAtMs, pointIndex) => {
      const point: SafeReserveApyMonitorData["chartPoints"][number] = {
        observedAt: new Date(observedAtMs).toISOString(),
        observedAtMs,
      };

      for (const [seriesIndex, series] of data.series.entries()) {
        point[series.key] = data.values[seriesIndex]?.[pointIndex] ?? null;
      }

      return point;
    }),
    generatedAt: data.generatedAt,
    sampleIntervalMinutes: data.sampleIntervalMinutes,
    series: data.series,
    statuses: data.statuses,
    window: data.window,
  };
}

type ApySortDirection = "asc" | "desc";

type AuditApiData = {
  activePage: {
    nextCursor: string | null;
    rows: SerializedRebalanceAuditRow[];
  };
  generatedAt: string;
  page: {
    nextCursor: string | null;
    rows: SerializedRebalanceAuditRow[];
  };
  summary: RebalanceAuditSummary;
};

type AuditLoadState =
  | { status: "loading" }
  | { data: AuditApiData; status: "ready" }
  | { message: string; status: "error" };

const DEFAULT_AUDIT_RANGE: RebalanceAuditRange = "24h";
const DEFAULT_AUDIT_VIEW: RebalanceAuditView = "completed_rebalances";
const DEFAULT_ERROR_FILTER: RebalanceAuditErrorFilter = "all";

function formatCompactStablecoinRaw(
  raw: bigint | string,
  liquidityMint: string | null
) {
  const parsedRaw = typeof raw === "bigint" ? raw : BigInt(raw);
  const zero = BigInt(0);
  const centScale = BigInt(10) ** BigInt(STABLECOIN_DECIMALS - 2);
  const sign = parsedRaw < zero ? "-" : "";
  const absolute = parsedRaw < zero ? -parsedRaw : parsedRaw;
  const roundedCents = (absolute + centScale / BigInt(2)) / centScale;
  const whole = roundedCents / BigInt(100);
  const cents = roundedCents % BigInt(100);
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const unit = getEarnStablecoinSymbol(liquidityMint) ?? "stablecoins";
  return `${sign}${wholeText}.${cents.toString().padStart(2, "0")} ${unit}`;
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

function createReserveLabelMap(data: SafeReserveApyMonitorData) {
  return new Map(
    data.statuses.map((row) => [
      row.reserve,
      row.marketName ?? row.market ?? formatShortAddress(row.reserve),
    ])
  );
}

function getCrossMintApyData(
  data: SafeReserveApyMonitorData
): SafeReserveApyMonitorData {
  const bestReserveByMint = new Map<string, SafeReserveApyStatusRow>();

  for (const status of data.statuses) {
    if (status.status !== "eligible" || status.supplyApyPercent === null) {
      continue;
    }

    const current = bestReserveByMint.get(status.liquidityMint);
    if (
      !current ||
      current.supplyApyPercent === null ||
      status.supplyApyPercent > current.supplyApyPercent
    ) {
      bestReserveByMint.set(status.liquidityMint, status);
    }
  }

  const reserveSet = new Set(
    [...bestReserveByMint.values()].map((status) => status.reserve)
  );

  return {
    ...data,
    series: data.series.filter((series) => reserveSet.has(series.reserve)),
  };
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
  return rows
    .filter((row) => row.decisionType === "rebalance")
    .map((row) => ({
      createdAt: row.createdAt,
      estimatedEdgeBps: row.estimatedEdgeBps,
      id: row.id,
      liquidityMint: row.liquidityMint,
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
    routes.map((route) => [
      `${route.liquidityMint}:${route.currentReserve}`,
      route,
    ])
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
          const route = routeByReserve.get(
            `${row.liquidityMint}:${row.reserve}`
          );

          return (
            <TableRow key={`${row.liquidityMint}:${row.reserve}`}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <span>{row.marketName ?? row.market}</span>
                  <Badge variant="outline">
                    {row.symbol ??
                      getEarnStablecoinSymbol(row.liquidityMint) ??
                      "Unknown mint"}
                  </Badge>
                </div>
                <div className="mt-1 text-xs font-normal text-muted-foreground">
                  <AddressLink address={row.reserve} />
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
                      {formatCompactStablecoinRaw(
                        route.activeAumRaw,
                        route.liquidityMint
                      )}
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

function formatAuditLane(lane: RebalanceAuditLane) {
  switch (lane) {
    case "rebalance":
      return "Rebalance";
    case "deposit":
      return "Deposit";
    case "needs_review":
      return "Needs review";
  }
}

function formatAuditSource(source: RebalanceAuditSource) {
  switch (source) {
    case "autodeposit":
      return "Autodeposit";
    case "idle_vault_deposit":
      return "Idle-vault deposit";
    case "manual_deposit":
      return "User deposit";
    case "rebalance":
      return "Rebalance";
    case "needs_review":
      return "Needs review";
  }
}

function formatAuditStatus(row: SerializedRebalanceAuditRow) {
  return row.lane === "needs_review"
    ? "Needs review"
    : formatReason(row.status);
}

function formatAuditAmount(row: SerializedRebalanceAuditRow) {
  return row.amountRaw === null
    ? "No amount"
    : formatCompactStablecoinRaw(
        row.amountRaw,
        row.liquidityMint ?? row.sourceLiquidityMint
      );
}

function formatAuditMint(row: SerializedRebalanceAuditRow) {
  const source = getEarnStablecoinSymbol(
    row.sourceLiquidityMint ?? row.liquidityMint
  );
  const target = getEarnStablecoinSymbol(row.targetLiquidityMint);

  return source && target && source !== target
    ? `${source} → ${target}`
    : source ?? target ?? "Unknown";
}

function formatDuration(createdAt: string, updatedAt: string) {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(updatedAt) - Date.parse(createdAt)) / 1000)
  );

  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatAge(createdAt: string) {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return "Age unavailable";
  }

  const seconds = Math.max(0, Math.round((Date.now() - createdAtMs) / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function isStaleActive(createdAt: string) {
  const createdAtMs = Date.parse(createdAt);
  return Number.isFinite(createdAtMs) && Date.now() - createdAtMs > 120_000;
}

function formatAuditRoute(
  row: SerializedRebalanceAuditRow,
  reserveLabels: ReadonlyMap<string, string>
) {
  if (row.lane === "rebalance") {
    return (
      <div className="flex min-w-44 flex-col">
        <span>
          {getReserveLabel(reserveLabels, row.sourceReserve)} →{" "}
          {getReserveLabel(reserveLabels, row.targetReserve)}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatBpsAsApyPercent(row.sourceApyBps)} →{" "}
          {formatBpsAsApyPercent(row.targetApyBps)}
        </span>
      </div>
    );
  }

  if (row.lane === "needs_review") {
    return (
      <div className="flex min-w-36 flex-col">
        <span>{getReserveLabel(reserveLabels, row.targetReserve)}</span>
        <span className="text-xs text-muted-foreground">
          {row.movementKind ?? "Unknown movement kind"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-36 flex-col">
      <span>{getReserveLabel(reserveLabels, row.targetReserve)}</span>
      <span className="text-xs text-muted-foreground">
        {formatAuditSource(row.source)}
      </span>
    </div>
  );
}

function AuditDetails({
  reserveLabels,
  row,
}: {
  reserveLabels: ReadonlyMap<string, string>;
  row: SerializedRebalanceAuditRow;
}) {
  const reason = row.abandonReason ?? row.decisionReason;

  return (
    <details className="mt-1 max-w-[28rem] text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Details
      </summary>
      <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2 text-muted-foreground">
        <div className="break-words">{formatReason(reason)}</div>
        <div>Movement {row.id}</div>
        <div>
          Mint {getEarnStablecoinSymbol(row.liquidityMint) ?? "unknown"}
        </div>
        <div>Source {formatAuditSource(row.source)}</div>
        <div>
          Vault {row.vaultPubkey ?? "record unavailable"} · index{" "}
          {row.vaultIndex ?? "unknown"}
        </div>
        {row.lane === "rebalance" ? (
          <div>
            {getReserveLabel(reserveLabels, row.sourceReserve)} →{" "}
            {getReserveLabel(reserveLabels, row.targetReserve)}
          </div>
        ) : (
          <div>
            Target {getReserveLabel(reserveLabels, row.targetReserve)} ·{" "}
            {row.movementKind ?? "Unknown movement kind"}
          </div>
        )}
        <div>Created {formatDateTime(row.createdAt)}</div>
        <div>Updated {formatDateTime(row.updatedAt)}</div>
        {row.submittedSlot ? (
          <div>Submitted slot {row.submittedSlot}</div>
        ) : null}
        {row.confirmedSlot ? (
          <div>Confirmed slot {row.confirmedSlot}</div>
        ) : null}
      </div>
    </details>
  );
}

function AuditTransactionLink({
  label,
  signature,
}: {
  label: string;
  signature: string | null;
}) {
  return signature ? (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">{label}</span>
      <OrbTransactionLink signature={signature}>
        {formatShortAddress(signature)}
      </OrbTransactionLink>
    </span>
  ) : null;
}

function AuditTransaction({ row }: { row: SerializedRebalanceAuditRow }) {
  return row.signature || row.secondarySignature ? (
    <div className="flex flex-col items-end gap-1">
      <AuditTransactionLink
        label={row.source === "autodeposit" ? "Deposit" : "Tx"}
        signature={row.signature}
      />
      {row.secondarySignature && row.secondarySignature !== row.signature ? (
        <AuditTransactionLink
          label="Sweep"
          signature={row.secondarySignature}
        />
      ) : null}
    </div>
  ) : (
    <span className="text-muted-foreground">No tx</span>
  );
}

function AuditVault({ row }: { row: SerializedRebalanceAuditRow }) {
  return (
    <div>
      <div className="font-medium">
        {row.vaultPubkey ? (
          <AddressLink address={row.vaultPubkey} />
        ) : (
          <span>Vault record missing</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        index {row.vaultIndex ?? "unknown"}
        {row.vaultId ? ` · id ${row.vaultId}` : null}
      </div>
    </div>
  );
}

function RebalanceAuditTable({
  rows,
  reserveLabels,
  view,
}: {
  reserveLabels: ReadonlyMap<string, string>;
  rows: SerializedRebalanceAuditRow[];
  view: RebalanceAuditView;
}) {
  const isErrors = view === "errors";
  const isDeposits = view === "completed_deposits";
  const emptyLabel = isErrors
    ? "No errors or needs-review records in this time range."
    : isDeposits
    ? "No completed deposits in this time range."
    : "No completed rebalances in this time range.";
  const columnCount = isErrors ? 9 : isDeposits ? 8 : 7;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{isErrors ? "Recorded at" : "Completed at"}</TableHead>
          {isErrors ? <TableHead>Type</TableHead> : null}
          <TableHead>Vault</TableHead>
          <TableHead>Mint</TableHead>
          {isDeposits ? <TableHead>Source</TableHead> : null}
          <TableHead>{isDeposits ? "Target" : "Route"}</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>{isErrors ? "Error" : "APY / Duration"}</TableHead>
          {isErrors ? <TableHead>Status</TableHead> : null}
          <TableHead className="text-right">Tx</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={columnCount}>
              {emptyLabel}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatDateTime(row.updatedAt)}
              </TableCell>
              {isErrors ? (
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge
                      variant={
                        row.lane === "needs_review" ? "destructive" : "outline"
                      }
                    >
                      {formatAuditSource(row.source)}
                    </Badge>
                    {row.lane === "needs_review" ? null : (
                      <span className="text-xs text-muted-foreground">
                        {formatAuditLane(row.lane)}
                      </span>
                    )}
                  </div>
                </TableCell>
              ) : null}
              <TableCell>
                <AuditVault row={row} />
              </TableCell>
              <TableCell className="font-medium">
                {formatAuditMint(row)}
              </TableCell>
              {isDeposits ? (
                <TableCell>
                  <Badge variant="outline">
                    {formatAuditSource(row.source)}
                  </Badge>
                </TableCell>
              ) : null}
              <TableCell>{formatAuditRoute(row, reserveLabels)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAuditAmount(row)}
              </TableCell>
              <TableCell>
                {isErrors ? (
                  <div className="max-w-[25rem] text-xs text-muted-foreground">
                    <div className="break-words">
                      {formatReason(row.abandonReason ?? row.decisionReason)}
                    </div>
                    <AuditDetails row={row} reserveLabels={reserveLabels} />
                  </div>
                ) : (
                  <div className="flex flex-col tabular-nums">
                    <span>
                      {isDeposits
                        ? formatBpsAsApyPercent(row.targetApyBps)
                        : `${formatBpsAsApyPercent(
                            row.sourceApyBps
                          )} → ${formatBpsAsApyPercent(
                            row.targetApyBps
                          )} (${formatBps(row.estimatedEdgeBps)})`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(row.createdAt, row.updatedAt)}
                    </span>
                  </div>
                )}
              </TableCell>
              {isErrors ? (
                <TableCell>
                  <Badge variant="destructive">{formatAuditStatus(row)}</Badge>
                </TableCell>
              ) : null}
              <TableCell className="text-right">
                <AuditTransaction row={row} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function ActiveMovementTable({
  reserveLabels,
  rows,
}: {
  reserveLabels: ReadonlyMap<string, string>;
  rows: SerializedRebalanceAuditRow[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Vault</TableHead>
          <TableHead>Mint</TableHead>
          <TableHead>Route / target</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Age</TableHead>
          <TableHead className="text-right">Tx</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={9}>
              No in-progress rows on this page.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const stale = isStaleActive(row.createdAt);

            return (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      row.lane === "needs_review" ? "destructive" : "outline"
                    }
                  >
                    {formatAuditLane(row.lane)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <AuditVault row={row} />
                </TableCell>
                <TableCell className="font-medium">
                  {formatAuditMint(row)}
                </TableCell>
                <TableCell>{formatAuditRoute(row, reserveLabels)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAuditAmount(row)}
                </TableCell>
                <TableCell>
                  <Badge variant={stale ? "destructive" : "secondary"}>
                    {formatAuditStatus(row)}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <span className={stale ? "font-medium text-destructive" : ""}>
                    {formatAge(row.createdAt)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <AuditTransaction row={row} />
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function CurrentReserveApyCard({
  dataByRouteMode,
}: {
  dataByRouteMode: Record<
    RebalanceRouteMode,
    {
      routes: SerializedActiveReserveRouteRow[];
      rows: SafeReserveApyStatusRow[];
    }
  >;
}) {
  const [routeMode, setRouteMode] = useState<RebalanceRouteMode>("same_mint");
  const { routes, rows } = dataByRouteMode[routeMode];

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="font-bold">Current Safe reserve APY</CardTitle>
        <CardDescription>
          {routeMode === "cross_mint"
            ? "Best currently eligible Safe reserve for each Crossmint target mint"
            : "Active verified Safe basket reserves for the selected stablecoin"}
        </CardDescription>
        <RouteModeSwitch
          id="current-safe-reserve-apy-route-mode"
          mode={routeMode}
          onModeChange={setRouteMode}
        />
      </CardHeader>
      <CardContent className="min-w-0 overflow-x-auto">
        <CurrentReserveApyTable routes={routes} rows={rows} />
      </CardContent>
    </Card>
  );
}

function isAuditView(value: string | null): value is RebalanceAuditView {
  return (
    value === "completed_rebalances" ||
    value === "completed_deposits" ||
    value === "errors"
  );
}

function isAuditRange(value: string | null): value is RebalanceAuditRange {
  return (
    value === "24h" || value === "7d" || value === "30d" || value === "all"
  );
}

function isErrorFilter(
  value: string | null
): value is RebalanceAuditErrorFilter {
  return (
    value === "all" ||
    value === "rebalance" ||
    value === "deposit" ||
    value === "needs_review"
  );
}

function updateAuditUrl(values: {
  activeCursor?: string | null;
  cursor?: string | null;
  errorFilter: RebalanceAuditErrorFilter;
  range: RebalanceAuditRange;
  routeMode: RebalanceRouteMode;
  view: RebalanceAuditView;
}) {
  const params = new URLSearchParams(window.location.search);
  params.set("auditView", values.view);
  params.set("auditRange", values.range);
  params.set("auditError", values.errorFilter);
  params.set("auditRouteMode", values.routeMode);

  if (values.cursor !== undefined) {
    if (values.cursor) {
      params.set("auditCursor", values.cursor);
    } else {
      params.delete("auditCursor");
    }
  }

  if (values.activeCursor !== undefined) {
    if (values.activeCursor) {
      params.set("auditActiveCursor", values.activeCursor);
    } else {
      params.delete("auditActiveCursor");
    }
  }

  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`
  );
}

function AuditSummaryStrip({
  activePage,
  onNextPage,
  reserveLabels,
  summary,
}: {
  activePage: AuditApiData["activePage"];
  onNextPage: (cursor: string) => void;
  reserveLabels: ReadonlyMap<string, string>;
  summary: RebalanceAuditSummary;
}) {
  if (summary.active === 0) {
    return null;
  }

  return (
    <div
      className={
        summary.staleActive > 0
          ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
          : "rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
      }
    >
      <div>
        <span className="font-medium">
          {summary.active} movement{summary.active === 1 ? "" : "s"} in progress
        </span>
        {summary.staleActive > 0 ? (
          <span className="text-muted-foreground">
            {" "}
            · {summary.staleActive} stale for more than two minutes
          </span>
        ) : null}
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border bg-background">
        <ActiveMovementTable
          reserveLabels={reserveLabels}
          rows={activePage.rows}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Showing {activePage.rows.length.toLocaleString("en-US")} newest
          in-progress rows
        </span>
        {activePage.nextCursor ? (
          <Button
            onClick={() => {
              if (activePage.nextCursor) {
                onNextPage(activePage.nextCursor);
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            More in progress
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RebalanceAuditCard({
  initialData,
  reserveLabels,
}: {
  initialData: AuditApiData;
  reserveLabels: ReadonlyMap<string, string>;
}) {
  const [view, setView] = useState<RebalanceAuditView>(DEFAULT_AUDIT_VIEW);
  const [range, setRange] = useState<RebalanceAuditRange>(DEFAULT_AUDIT_RANGE);
  const [routeMode, setRouteMode] = useState<RebalanceRouteMode>("same_mint");
  const [errorFilter, setErrorFilter] =
    useState<RebalanceAuditErrorFilter>(DEFAULT_ERROR_FILTER);
  const [cursor, setCursor] = useState<string | null>(null);
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<AuditLoadState>({
    data: initialData,
    status: "ready",
  });
  const skipInitialDefaultLoad = useRef(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextView = params.get("auditView");
    const nextRange = params.get("auditRange");
    const nextError = params.get("auditError");
    const nextRouteMode = params.get("auditRouteMode");

    if (isAuditView(nextView)) {
      setView(nextView);
    }
    if (isAuditRange(nextRange)) {
      setRange(nextRange);
    }
    if (isErrorFilter(nextError)) {
      setErrorFilter(nextError);
    }
    if (nextRouteMode === "same_mint" || nextRouteMode === "cross_mint") {
      setRouteMode(nextRouteMode);
    }
    setCursor(params.get("auditCursor"));
    setActiveCursor(params.get("auditActiveCursor"));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (
      skipInitialDefaultLoad.current &&
      view === DEFAULT_AUDIT_VIEW &&
      range === DEFAULT_AUDIT_RANGE &&
      routeMode === "same_mint" &&
      errorFilter === DEFAULT_ERROR_FILTER &&
      cursor === null &&
      activeCursor === null &&
      refreshToken === 0
    ) {
      skipInitialDefaultLoad.current = false;
      return;
    }
    skipInitialDefaultLoad.current = false;

    const controller = new AbortController();
    let mounted = true;

    async function loadAudit() {
      const params = new URLSearchParams({
        errorFilter,
        range,
        routeMode,
        view,
      });
      if (cursor) {
        params.set("cursor", cursor);
      }
      if (activeCursor) {
        params.set("activeCursor", activeCursor);
      }

      try {
        const response = await fetch(`/api/earn/rebalance/audit?${params}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Audit request failed: ${response.status}`);
        }

        const data = (await response.json()) as AuditApiData;
        if (mounted) {
          setState({ data, status: "ready" });
        }
      } catch (error) {
        if (!mounted || controller.signal.aborted) {
          return;
        }

        setState({
          message:
            error instanceof Error ? error.message : "Audit request failed.",
          status: "error",
        });
      }
    }

    void loadAudit();
    const interval = window.setInterval(() => void loadAudit(), 60_000);

    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [
    activeCursor,
    cursor,
    errorFilter,
    hydrated,
    range,
    refreshToken,
    routeMode,
    view,
  ]);

  function selectView(nextView: RebalanceAuditView) {
    setView(nextView);
    setCursor(null);
    setActiveCursor(null);
    updateAuditUrl({
      activeCursor: null,
      cursor: null,
      errorFilter,
      range,
      routeMode,
      view: nextView,
    });
  }

  function selectRange(nextRange: RebalanceAuditRange) {
    setRange(nextRange);
    setCursor(null);
    setActiveCursor(null);
    updateAuditUrl({
      activeCursor: null,
      cursor: null,
      errorFilter,
      range: nextRange,
      routeMode,
      view,
    });
  }

  function selectErrorFilter(nextErrorFilter: RebalanceAuditErrorFilter) {
    setErrorFilter(nextErrorFilter);
    setCursor(null);
    setActiveCursor(null);
    updateAuditUrl({
      activeCursor: null,
      cursor: null,
      errorFilter: nextErrorFilter,
      range,
      routeMode,
      view,
    });
  }

  const summary = state.status === "ready" ? state.data.summary : null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="font-bold">Movement audit</CardTitle>
            <CardDescription>
              Confirmed rebalances, user/autodeposits, idle-vault deposits,
              persisted autodeposit failures, and needs-review records. Worker
              failures before a decision or execution is persisted remain
              outside this view. The mode switch filters rebalance records;
              deposit records remain shared.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
            <RouteModeSwitch
              id="movement-audit-route-mode"
              mode={routeMode}
              onModeChange={(nextRouteMode) => {
                setRouteMode(nextRouteMode);
                setCursor(null);
                setActiveCursor(null);
                updateAuditUrl({
                  activeCursor: null,
                  cursor: null,
                  errorFilter,
                  range,
                  routeMode: nextRouteMode,
                  view,
                });
              }}
            />
            <div className="flex items-center gap-2">
              <Select
                value={range}
                onValueChange={(value) => {
                  if (isAuditRange(value)) {
                    selectRange(value);
                  }
                }}
              >
                <SelectTrigger
                  aria-label="Movement audit range"
                  className="w-[9rem]"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              <Button
                aria-label="Refresh movement audit"
                onClick={() => setRefreshToken((value) => value + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon aria-hidden="true" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
        {state.status === "ready" ? (
          <div className="text-xs text-muted-foreground">
            Updated {formatDateTime(state.data.generatedAt)} · counts are
            movement records in the selected range
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {state.status === "loading" ? (
          <RebalanceDecisionAuditFallback />
        ) : state.status === "error" ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
            {state.message}
          </div>
        ) : (
          <>
            <AuditSummaryStrip
              activePage={state.data.activePage}
              onNextPage={(nextCursor) => {
                setActiveCursor(nextCursor);
                updateAuditUrl({
                  activeCursor: nextCursor,
                  errorFilter,
                  range,
                  routeMode,
                  view,
                });
              }}
              reserveLabels={reserveLabels}
              summary={state.data.summary}
            />
            <Tabs
              value={view}
              onValueChange={(value) => {
                if (isAuditView(value)) {
                  selectView(value);
                }
              }}
            >
              <TabsList className="grid h-auto w-full grid-cols-1 items-stretch gap-1 bg-muted/60 p-1 sm:grid-cols-3">
                <TabsTrigger value="completed_rebalances" className="h-10">
                  Completed rebalances
                  <Badge variant="outline">
                    {state.data.summary.completedRebalances.toLocaleString(
                      "en-US"
                    )}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="completed_deposits" className="h-10">
                  Completed deposits
                  <Badge variant="outline">
                    {state.data.summary.completedDeposits.toLocaleString(
                      "en-US"
                    )}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="errors" className="h-10">
                  Errors
                  <Badge
                    variant={
                      state.data.summary.errors > 0 ? "destructive" : "outline"
                    }
                  >
                    {state.data.summary.errors.toLocaleString("en-US")}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {view === "errors" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Error type
                </span>
                {(
                  [
                    ["all", "All", state.data.summary.errors],
                    [
                      "rebalance",
                      "Rebalances",
                      state.data.summary.rebalanceErrors,
                    ],
                    ["deposit", "Deposits", state.data.summary.depositErrors],
                    [
                      "needs_review",
                      "Needs review",
                      state.data.summary.needsReview,
                    ],
                  ] as const
                ).map(([value, label, count]) => (
                  <Button
                    aria-pressed={errorFilter === value}
                    key={value}
                    onClick={() => selectErrorFilter(value)}
                    size="sm"
                    type="button"
                    variant={errorFilter === value ? "secondary" : "ghost"}
                  >
                    {label} ({count.toLocaleString("en-US")})
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <RebalanceAuditTable
                reserveLabels={reserveLabels}
                rows={state.data.page.rows}
                view={view}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
              <span>
                Showing {state.data.page.rows.length.toLocaleString("en-US")}{" "}
                newest rows
              </span>
              <Button
                disabled={!state.data.page.nextCursor}
                onClick={() => {
                  const nextCursor = state.data.page.nextCursor;
                  if (nextCursor) {
                    setCursor(nextCursor);
                    updateAuditUrl({
                      errorFilter,
                      range,
                      routeMode,
                      view,
                      cursor: nextCursor,
                    });
                  }
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Next page
              </Button>
            </div>
          </>
        )}
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
    <Card className="w-full">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
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

function OverviewFallback() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-24 w-full" />
      <CurrentReserveApyFallback />
    </div>
  );
}

type RebalanceOverviewWireData = Pick<
  RebalanceApiWireData,
  "decisions" | "routes"
> & {
  eligibilityFloorRaw: string | null;
  statuses: SafeReserveApyStatusRow[];
};
type RebalanceApyHistoryWireData = Pick<RebalanceApiWireData, "apyData">;
type RebalanceOperationsWireData = Pick<
  RebalanceApiWireData,
  "activity" | "autodeposit" | "last30DaysRebalances"
>;
type RebalanceExecutionsWireData = Pick<
  RebalanceApiWireData,
  "executedRebalances"
>;
type RebalanceFrequencyWireData = Pick<
  RebalanceApiWireData,
  "vaultRebalanceFrequency"
>;
type RebalanceSectionState<T> = {
  data?: T;
  message?: string;
  ref: (element: HTMLElement | null) => void;
  status: "error" | "idle" | "loading" | "ready";
};

function useProgressiveSection<T>(
  endpoint: string,
  options: { enabled?: boolean; immediate?: boolean } = {}
): RebalanceSectionState<T> {
  const { enabled = true, immediate = false } = options;
  const [element, setElement] = useState<HTMLElement | null>(null);
  const started = useRef(false);
  const [state, setState] = useState<Omit<RebalanceSectionState<T>, "ref">>({
    status: "idle",
  });

  useEffect(() => {
    if (!enabled || !element || started.current) {
      return;
    }

    let activeController: AbortController | null = null;
    let mounted = true;
    const load = async () => {
      if (started.current) {
        return;
      }
      started.current = true;
      const controller = new AbortController();
      activeController = controller;
      setState({ status: "loading" });

      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Rebalance section request failed: ${response.status}`
          );
        }
        const data = (await response.json()) as T;
        if (mounted) {
          setState({ data, status: "ready" });
        }
      } catch (error) {
        if (!mounted || controller.signal.aborted) {
          return;
        }
        setState({
          message:
            error instanceof Error
              ? error.message
              : "Rebalance section request failed.",
          status: "error",
        });
      }
    };

    if (immediate) {
      void load();
      return () => {
        mounted = false;
        activeController?.abort();
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "0px" }
    );
    observer.observe(element);
    return () => {
      mounted = false;
      activeController?.abort();
      observer.disconnect();
    };
  }, [element, enabled, endpoint, immediate]);

  return { ...state, ref: setElement };
}

function ProgressiveSection<T>({
  children,
  fallback,
  name,
  section,
}: {
  children: ReactNode;
  fallback: ReactNode;
  name: string;
  section: RebalanceSectionState<T>;
}) {
  const reservedHeightBySection: Record<string, string> = {
    "rebalance-apy-history": "h-[52rem]",
    "rebalance-audit": "min-h-[108rem]",
    "rebalance-executions": "h-[46rem]",
    "rebalance-frequency": "h-[48rem]",
    "rebalance-operations": "min-h-[44rem]",
    "rebalance-overview": "h-[42rem]",
  };

  return (
    <section
      className={`grid gap-6 ${reservedHeightBySection[name] ?? ""}`}
      data-progressive-section={name}
      data-progressive-state={section.status}
      ref={section.ref}
      style={{ overflowAnchor: "none" }}
    >
      {section.status === "ready" ? (
        children
      ) : section.status === "error" ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-bold">Section unavailable</CardTitle>
            <CardDescription>
              {section.message ?? "This section could not be loaded."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        fallback
      )}
    </section>
  );
}

function OperationsFallback() {
  return <Skeleton className="h-[44rem] w-full" />;
}

function ExecutionsFallback() {
  return <Skeleton className="h-[36rem] w-full" />;
}

function FrequencyFallback() {
  return <Skeleton className="h-[40rem] w-full" />;
}

function AuditFallback() {
  return (
    <div className="min-h-[48rem]">
      <RebalanceDecisionAuditFallback />
    </div>
  );
}

function deserializeOverviewData(
  wireData: RebalanceOverviewWireData
): Pick<RebalanceApiData, "apyData" | "decisions" | "routes"> {
  const series = wireData.statuses.map((status, index) => ({
    key: `reserve${index + 1}`,
    label:
      `${
        status.symbol ??
        getEarnStablecoinSymbol(status.liquidityMint) ??
        "Unknown"
      } · ` + `${status.marketName ?? status.market}`,
    liquidityMint: status.liquidityMint,
    marketName: status.marketName,
    reserve: status.reserve,
  }));

  return {
    apyData: {
      chartPoints: [],
      generatedAt: "",
      sampleIntervalMinutes: 30,
      series,
      statuses: wireData.statuses,
      window: { endedAt: "", startedAt: "" },
    },
    decisions: wireData.decisions,
    routes: wireData.routes,
  };
}

function encodeStatusesForRequest(statuses: SafeReserveApyStatusRow[]) {
  return encodeURIComponent(JSON.stringify(statuses));
}

function deserializeExecutionsData(
  wireData: RebalanceExecutionsWireData
): RebalanceApiData["executedRebalances"] {
  return {
    ...wireData.executedRebalances,
    chartPoints: wireData.executedRebalances.chartPoints.map((row) =>
      deserializeExecutedRebalance(row, wireData.executedRebalances.strings)
    ),
    details: wireData.executedRebalances.details.map((row) =>
      deserializeExecutedRebalance(row, wireData.executedRebalances.strings)
    ),
  };
}

function deserializeFrequencyData(
  wireData: RebalanceFrequencyWireData
): RebalanceApiData["vaultRebalanceFrequency"] {
  return {
    ...wireData.vaultRebalanceFrequency,
    chartPoints: wireData.vaultRebalanceFrequency.chartPoints.map(
      deserializeVaultFrequency
    ),
    details: wireData.vaultRebalanceFrequency.details.map(
      deserializeVaultFrequency
    ),
  };
}

export function RebalanceMonitorClient() {
  const overview = useProgressiveSection<RebalanceOverviewWireData>(
    "/api/earn/rebalance?section=overview",
    { immediate: true }
  );
  const apyHistoryEndpoint = overview.data
    ? `/api/earn/rebalance?section=apy-history&statuses=${encodeStatusesForRequest(
        overview.data.statuses
      )}`
    : "/api/earn/rebalance?section=apy-history";
  const apyHistory = useProgressiveSection<RebalanceApyHistoryWireData>(
    apyHistoryEndpoint,
    { enabled: overview.status === "ready" }
  );
  const operations = useProgressiveSection<RebalanceOperationsWireData>(
    "/api/earn/rebalance?section=operations",
    { enabled: overview.status === "ready" }
  );
  const executions = useProgressiveSection<RebalanceExecutionsWireData>(
    "/api/earn/rebalance?section=executions",
    { enabled: overview.status === "ready" }
  );
  const frequencyEndpoint = overview.data
    ? `/api/earn/rebalance?section=frequency&eligibilityFloorRaw=${
        overview.data.eligibilityFloorRaw ?? "null"
      }`
    : "/api/earn/rebalance?section=frequency";
  const frequency = useProgressiveSection<RebalanceFrequencyWireData>(
    frequencyEndpoint,
    { enabled: overview.status === "ready" }
  );
  const audit = useProgressiveSection<AuditApiData>(
    "/api/earn/rebalance/audit?errorFilter=all&range=24h&routeMode=same_mint&view=completed_rebalances",
    { enabled: overview.status === "ready" }
  );
  const [selectedMint, setSelectedMint] = useState("USDC");
  const overviewData = overview.data
    ? deserializeOverviewData(overview.data)
    : undefined;
  const loadedApyData = apyHistory.data
    ? deserializeApyData(apyHistory.data.apyData)
    : undefined;
  const displayApyData = overviewData
    ? loadedApyData ?? overviewData.apyData
    : undefined;
  const operationsData = operations.data;
  const executionsData = executions.data
    ? deserializeExecutionsData(executions.data)
    : undefined;
  const frequencyData = frequency.data
    ? deserializeFrequencyData(frequency.data)
    : undefined;

  const selectedDescriptor = EARN_STABLECOIN_DESCRIPTORS.find(
    ({ symbol }) => symbol === selectedMint
  );
  const selectedMintAddress = selectedDescriptor?.mint ?? null;
  const reserveLabels = overviewData
    ? createReserveLabelMap(overviewData.apyData)
    : new Map<string, string>();
  const filteredApyData = displayApyData
    ? selectedMintAddress
      ? {
          ...displayApyData,
          series: displayApyData.series.filter(
            (series) => series.liquidityMint === selectedMintAddress
          ),
          statuses: displayApyData.statuses.filter(
            (status) => status.liquidityMint === selectedMintAddress
          ),
        }
      : displayApyData
    : undefined;
  const filteredRoutes = overviewData
    ? selectedMintAddress
      ? overviewData.routes.filter(
          (route) => route.liquidityMint === selectedMintAddress
        )
      : overviewData.routes
    : [];
  const filteredDecisions = overviewData
    ? selectedMintAddress
      ? overviewData.decisions.filter(
          (decision) =>
            decision.routeMode === "cross_mint" ||
            decision.liquidityMint === selectedMintAddress
        )
      : overviewData.decisions
    : [];
  const filteredExecutedRebalances = executionsData
    ? selectedMintAddress
      ? {
          ...executionsData,
          chartPoints: executionsData.chartPoints.filter(
            (execution) =>
              execution.routeMode === "cross_mint" ||
              execution.liquidityMint === selectedMintAddress
          ),
          details: executionsData.details.filter(
            (execution) =>
              execution.routeMode === "cross_mint" ||
              execution.liquidityMint === selectedMintAddress
          ),
          summaries: executionsData.summaries.filter(
            (summary) =>
              summary.routeMode === "cross_mint" ||
              summary.liquidityMint === selectedMintAddress
          ),
        }
      : executionsData
    : undefined;
  const filteredFrequencyVaults = frequencyData
    ? selectedMintAddress
      ? frequencyData.chartPoints.filter(
          (vault) =>
            vault.routeMode === "cross_mint" ||
            vault.liquidityMint === selectedMintAddress
        )
      : frequencyData.chartPoints
    : [];
  const filteredFrequencyDetails = frequencyData
    ? selectedMintAddress
      ? frequencyData.details.filter(
          (vault) =>
            vault.routeMode === "cross_mint" ||
            vault.liquidityMint === selectedMintAddress
        )
      : frequencyData.details
    : [];
  const filteredFrequencySummaries = frequencyData
    ? selectedMintAddress
      ? frequencyData.summaries.filter(
          (summary) =>
            summary.routeMode === "cross_mint" ||
            summary.liquidityMint === selectedMintAddress
        )
      : frequencyData.summaries
    : [];
  const filteredVaultRebalanceFrequency = frequencyData
    ? {
        ...frequencyData,
        chartPoints: filteredFrequencyVaults,
        details: filteredFrequencyDetails,
        summaries: filteredFrequencySummaries,
        vaultCount: filteredFrequencySummaries.reduce(
          (total, summary) => total + summary.vaultCount,
          0
        ),
      }
    : undefined;
  const crossMintApyData = displayApyData
    ? getCrossMintApyData(displayApyData)
    : undefined;

  return (
    <div
      className="mx-auto grid w-full max-w-4xl gap-6"
      data-progressive-page="/earn/rebalance"
      style={{ overflowAnchor: "none" }}
    >
      <ProgressiveSection
        fallback={<OverviewFallback />}
        name="rebalance-overview"
        section={overview}
      >
        <Card>
          <CardHeader>
            <CardTitle className="font-bold">Stablecoin filter</CardTitle>
            <CardDescription>
              Filters same-mint reserves, executions, and vault frequency.
              Crossmint cards show all Crossmint routes and the best currently
              eligible Safe reserve for each supported target mint.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={selectedMint} onValueChange={setSelectedMint}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue>
                  {selectedMint === "all" ? "All stablecoins" : selectedMint}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stablecoins</SelectItem>
                {EARN_STABLECOIN_DESCRIPTORS.map(({ mint, symbol }) => (
                  <SelectItem key={mint} value={symbol}>
                    {symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        {overviewData &&
        displayApyData &&
        filteredApyData &&
        crossMintApyData ? (
          <>
            <CurrentReserveApyCard
              dataByRouteMode={{
                cross_mint: {
                  routes: overviewData.routes.filter((route) =>
                    crossMintApyData.series.some(
                      (series) => series.reserve === route.currentReserve
                    )
                  ),
                  rows: displayApyData.statuses.filter((status) =>
                    crossMintApyData.series.some(
                      (series) => series.reserve === status.reserve
                    )
                  ),
                },
                same_mint: {
                  routes: filteredRoutes,
                  rows: filteredApyData.statuses,
                },
              }}
            />
          </>
        ) : null}
      </ProgressiveSection>
      <ProgressiveSection
        fallback={<ApyChartFallback />}
        name="rebalance-apy-history"
        section={apyHistory}
      >
        {loadedApyData && filteredApyData && crossMintApyData ? (
          <SafeReserveApyChart
            dataByRouteMode={{
              cross_mint: crossMintApyData,
              same_mint: filteredApyData,
            }}
            decisionMarkersByRouteMode={{
              cross_mint: toDecisionMarkers(
                filteredDecisions.filter(
                  (decision) => decision.routeMode === "cross_mint"
                )
              ),
              same_mint: toDecisionMarkers(
                filteredDecisions.filter(
                  (decision) => decision.routeMode === "same_mint"
                )
              ),
            }}
          />
        ) : null}
      </ProgressiveSection>
      <ProgressiveSection
        fallback={<OperationsFallback />}
        name="rebalance-operations"
        section={operations}
      >
        {operationsData ? (
          <RebalanceActivityChart data={operationsData.activity} />
        ) : null}
      </ProgressiveSection>
      <ProgressiveSection
        fallback={<ExecutionsFallback />}
        name="rebalance-executions"
        section={executions}
      >
        {filteredExecutedRebalances ? (
          <ExecutedEarnRebalancesChart
            data={filteredExecutedRebalances}
            key={`executed-${selectedMint}`}
            liquidityMint={selectedMintAddress}
            reserveLabels={reserveLabels}
          />
        ) : null}
      </ProgressiveSection>
      <ProgressiveSection
        fallback={<FrequencyFallback />}
        name="rebalance-frequency"
        section={frequency}
      >
        {filteredVaultRebalanceFrequency && filteredApyData ? (
          <EarnVaultRebalanceFrequencyChart
            data={filteredVaultRebalanceFrequency}
            key={`frequency-${selectedMint}`}
            liquidityMint={selectedMintAddress}
            reserveStatuses={filteredApyData.statuses}
          />
        ) : null}
      </ProgressiveSection>
      <div className="grid min-h-[52rem] gap-6">
        {operationsData ? (
          <>
            <Last30DaysRebalanceChart
              data={operationsData.last30DaysRebalances}
            />
            <AutodepositFailuresChart data={operationsData.autodeposit} />
          </>
        ) : (
          <>
            <Skeleton className="h-[26rem] w-full" />
            <Skeleton className="h-[25rem] w-full" />
          </>
        )}
      </div>
      <ProgressiveSection
        fallback={<AuditFallback />}
        name="rebalance-audit"
        section={audit}
      >
        {audit.data ? (
          <RebalanceAuditCard
            initialData={audit.data}
            reserveLabels={reserveLabels}
          />
        ) : null}
      </ProgressiveSection>
    </div>
  );
}
