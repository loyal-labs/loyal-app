"use client";

import { useEffect, useState } from "react";
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
} from "./rebalance-data";

const USDC_DECIMALS = 6;

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

type RebalanceApiData = {
  activity: RebalanceActivityPoint[];
  apyData: SafeReserveApyMonitorData;
  autodeposit: SerializedAutodepositFailureRange[];
  decisions: SerializedRebalanceDecisionRow[];
  last30DaysRebalances: Last30DaysRebalancePoint[];
  routes: SerializedActiveReserveRouteRow[];
};

type LoadState =
  | { status: "loading" }
  | { data: RebalanceApiData; status: "ready" }
  | { message: string; status: "error" };

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
  return rows
    .filter((row) => row.decisionType === "rebalance")
    .map((row) => ({
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

function formatAuditAmount(raw: string | null) {
  return raw === null ? "No amount" : formatCompactUsdcRaw(raw);
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
  const columnCount = isErrors ? 8 : isDeposits ? 7 : 6;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{isErrors ? "Recorded at" : "Completed at"}</TableHead>
          {isErrors ? <TableHead>Type</TableHead> : null}
          <TableHead>Vault</TableHead>
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
              {isDeposits ? (
                <TableCell>
                  <Badge variant="outline">
                    {formatAuditSource(row.source)}
                  </Badge>
                </TableCell>
              ) : null}
              <TableCell>{formatAuditRoute(row, reserveLabels)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAuditAmount(row.amountRaw)}
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
            <TableCell className="text-muted-foreground" colSpan={8}>
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
                <TableCell>{formatAuditRoute(row, reserveLabels)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAuditAmount(row.amountRaw)}
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
  view: RebalanceAuditView;
}) {
  const params = new URLSearchParams(window.location.search);
  params.set("auditView", values.view);
  params.set("auditRange", values.range);
  params.set("auditError", values.errorFilter);

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
          Showing {activePage.rows.length.toLocaleString()} newest in-progress
          rows
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
  reserveLabels,
}: {
  reserveLabels: ReadonlyMap<string, string>;
}) {
  const [view, setView] = useState<RebalanceAuditView>(DEFAULT_AUDIT_VIEW);
  const [range, setRange] = useState<RebalanceAuditRange>(DEFAULT_AUDIT_RANGE);
  const [errorFilter, setErrorFilter] =
    useState<RebalanceAuditErrorFilter>(DEFAULT_ERROR_FILTER);
  const [cursor, setCursor] = useState<string | null>(null);
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<AuditLoadState>({ status: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextView = params.get("auditView");
    const nextRange = params.get("auditRange");
    const nextError = params.get("auditError");

    if (isAuditView(nextView)) {
      setView(nextView);
    }
    if (isAuditRange(nextRange)) {
      setRange(nextRange);
    }
    if (isErrorFilter(nextError)) {
      setErrorFilter(nextError);
    }
    setCursor(params.get("auditCursor"));
    setActiveCursor(params.get("auditActiveCursor"));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const controller = new AbortController();
    let mounted = true;

    async function loadAudit() {
      const params = new URLSearchParams({
        errorFilter,
        range,
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
  }, [activeCursor, cursor, errorFilter, hydrated, range, refreshToken, view]);

  function selectView(nextView: RebalanceAuditView) {
    setView(nextView);
    setCursor(null);
    setActiveCursor(null);
    updateAuditUrl({
      activeCursor: null,
      cursor: null,
      errorFilter,
      range,
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
              outside this view.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Range</span>
            <Select
              value={range}
              onValueChange={(value) => {
                if (isAuditRange(value)) {
                  selectRange(value);
                }
              }}
            >
              <SelectTrigger className="w-[7.5rem]" size="sm">
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
                    {state.data.summary.completedRebalances.toLocaleString()}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="completed_deposits" className="h-10">
                  Completed deposits
                  <Badge variant="outline">
                    {state.data.summary.completedDeposits.toLocaleString()}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="errors" className="h-10">
                  Errors
                  <Badge
                    variant={
                      state.data.summary.errors > 0 ? "destructive" : "outline"
                    }
                  >
                    {state.data.summary.errors.toLocaleString()}
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
                    {label} ({count.toLocaleString()})
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
                Showing {state.data.page.rows.length.toLocaleString()} newest
                rows
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
      <ApyChartFallback />
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
      <RebalanceActivityChart data={state.data.activity} />
      <Last30DaysRebalanceChart data={state.data.last30DaysRebalances} />
      <AutodepositFailuresChart data={state.data.autodeposit} />
      <RebalanceAuditCard reserveLabels={reserveLabels} />
    </div>
  );
}
