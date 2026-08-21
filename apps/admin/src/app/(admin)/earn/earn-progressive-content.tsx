"use client";

import { AddressLink } from "@/components/blockchain/address-link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";

import type { EarnData, EarnFlowPoint, EarnPositionRow } from "./earn-data";
import type { EarnStablecoinHealthRow } from "./earn-stablecoin-monitoring";
import { CopyAddressButton } from "./copy-address-button";
import {
  type EarnFundingData,
  type EarnFundingWallet,
} from "./earn-funding-data";
import type { AdminEarnSnapshot } from "./earn-snapshot";
import { OperationalWalletSpendingCharts } from "./operational-wallet-spending-charts";
import {
  EARN_STABLECOIN_DESCRIPTORS,
  getEarnStablecoinBySymbol,
  getEarnStablecoinSymbol,
  STABLECOIN_DECIMALS,
  type EarnStablecoinSymbol,
} from "@/lib/earn/stablecoin-monitor.shared";

export function ProgressiveSkeleton({ className }: { className: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-6 h-40 w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

const POSITION_SORT_LABELS = {
  idle: "Idle stablecoins",
  normalized: "Normalized current",
  observed: "Observed",
  pointerDelta: "Pointer delta",
  principal: "Principal",
  reserve: "Reserve value",
  warnings: "Warnings",
} as const;

type PositionSortKey = keyof typeof POSITION_SORT_LABELS;
type PositionSortDirection = "asc" | "desc";
type PositionSortState = {
  direction: PositionSortDirection;
  key: PositionSortKey;
};
type EarnPageSearchParams = {
  mint?: string | string[];
  positionDirection?: string | string[];
  positionSort?: string | string[];
};

const DEFAULT_POSITION_SORT: PositionSortState = {
  direction: "desc",
  key: "normalized",
};

function formatCompactStablecoinRaw(raw: bigint, unit: string) {
  const zero = BigInt(0);
  const centScale = BigInt(10) ** BigInt(STABLECOIN_DECIMALS - 2);
  const sign = raw < zero ? "-" : "";
  const absolute = raw < zero ? -raw : raw;
  const roundedCents = (absolute + centScale / BigInt(2)) / centScale;
  const whole = roundedCents / BigInt(100);
  const cents = roundedCents % BigInt(100);
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign}${wholeText}.${cents.toString().padStart(2, "0")} ${unit}`;
}

function formatNominalUsdRaw(raw: bigint) {
  return formatCompactStablecoinRaw(raw, "nominal USD");
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSelectedMint(
  searchParams: EarnPageSearchParams | undefined
): EarnStablecoinSymbol | null {
  const value = getSearchParamValue(searchParams?.mint);
  return value && getEarnStablecoinBySymbol(value)
    ? (value as EarnStablecoinSymbol)
    : null;
}

function amountUnit(symbol: EarnStablecoinSymbol | null) {
  return symbol ?? "nominal USD";
}

function aggregateFlowPoints(
  points: readonly EarnFlowPoint[],
  selectedMint: EarnStablecoinSymbol | null
): EarnFlowPoint[] {
  const selectedDescriptor = selectedMint
    ? getEarnStablecoinBySymbol(selectedMint)
    : null;
  if (selectedDescriptor) {
    return points.filter(
      (point) => point.liquidityMint === selectedDescriptor.mint
    );
  }

  const byDate = new Map<string, EarnFlowPoint>();
  for (const point of points) {
    const current = byDate.get(point.date);
    byDate.set(point.date, {
      date: point.date,
      depositedRaw: (current?.depositedRaw ?? BigInt(0)) + point.depositedRaw,
      liquidityMint: "all",
      netRaw: (current?.netRaw ?? BigInt(0)) + point.netRaw,
      withdrawnRaw: (current?.withdrawnRaw ?? BigInt(0)) + point.withdrawnRaw,
    });
  }

  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date)
  );
}

function parsePositionSort(
  searchParams: EarnPageSearchParams | undefined
): PositionSortState {
  const sort = getSearchParamValue(searchParams?.positionSort);
  const direction = getSearchParamValue(searchParams?.positionDirection);
  const key = sort && sort in POSITION_SORT_LABELS ? sort : null;

  return {
    direction: direction === "asc" ? "asc" : DEFAULT_POSITION_SORT.direction,
    key: (key ?? DEFAULT_POSITION_SORT.key) as PositionSortKey,
  };
}

function compareBigInt(left: bigint, right: bigint) {
  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

function comparePositionValues(
  left: EarnPositionRow,
  right: EarnPositionRow,
  key: PositionSortKey
) {
  switch (key) {
    case "idle":
      return compareBigInt(left.idleAmountRaw, right.idleAmountRaw);
    case "observed":
      return (
        new Date(left.currentObservedAt).getTime() -
        new Date(right.currentObservedAt).getTime()
      );
    case "pointerDelta":
      return compareBigInt(
        left.currentPointerDeltaRaw,
        right.currentPointerDeltaRaw
      );
    case "principal":
      return compareBigInt(left.principalAmountRaw, right.principalAmountRaw);
    case "reserve":
      return compareBigInt(
        left.normalizedReserveRaw,
        right.normalizedReserveRaw
      );
    case "warnings":
      return (
        getTopPositionWarningCount(left) - getTopPositionWarningCount(right)
      );
    case "normalized":
    default:
      return compareBigInt(left.normalizedAumRaw, right.normalizedAumRaw);
  }
}

function sortTopPositions(
  positions: EarnPositionRow[],
  sort: PositionSortState
) {
  const multiplier = sort.direction === "asc" ? 1 : -1;

  return positions.slice().sort((left, right) => {
    const primary = comparePositionValues(left, right, sort.key);

    if (primary !== 0) {
      return primary * multiplier;
    }

    return compareBigInt(right.normalizedAumRaw, left.normalizedAumRaw);
  });
}

function StatCard({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{description}</CardDescription>
        <CardTitle className="text-2xl font-bold tabular-nums">
          {title}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function formatSolLamports(lamports: string | null) {
  if (!lamports) {
    return "Unknown";
  }

  const raw = BigInt(lamports);
  const whole = raw / BigInt(1_000_000_000);
  const fraction = (raw % BigInt(1_000_000_000))
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");

  return `${whole.toString()}.${fraction || "0"} SOL`;
}

function formatRunway(runwayHours: number | null) {
  if (runwayHours === null) {
    return "No spend data";
  }

  if (runwayHours < 48) {
    return `${runwayHours.toFixed(1)}h runway`;
  }

  return `${(runwayHours / 24).toFixed(1)}d runway`;
}

function statusVariant(status: EarnFundingWallet["status"]) {
  switch (status) {
    case "critical":
      return "destructive" as const;
    case "low":
      return "secondary" as const;
    case "healthy":
      return "outline" as const;
    case "unknown":
    default:
      return "outline" as const;
  }
}

function getWalletTitle(wallet: EarnFundingWallet) {
  if (wallet.roles.length === 1) {
    return wallet.roles[0].label;
  }

  return "Policy + deployment wallet";
}

function OperationalWalletCard({ wallet }: { wallet: EarnFundingWallet }) {
  return (
    <Card className="h-full">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-bold leading-tight">
              {getWalletTitle(wallet)}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Mainnet wallet
            </CardDescription>
          </div>
          <Badge
            className="shrink-0 whitespace-nowrap"
            variant={statusVariant(wallet.status)}
          >
            {wallet.status}
          </Badge>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <AddressLink
            address={wallet.address}
            aria-label={`Open ${wallet.address} on Orb`}
            className="min-w-0 truncate text-xs"
            edgeLength={8}
            title={wallet.address}
          />
          <CopyAddressButton address={wallet.address} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs text-muted-foreground">
            Current SOL balance
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatSolLamports(wallet.balanceLamports)}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            {wallet.balanceLamports
              ? `${wallet.balanceLamports} lamports`
              : "Exact lamports unavailable"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {wallet.statusDetail}
          </div>
          {wallet.minimumLamports ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Safety floor: {formatSolLamports(wallet.minimumLamports)}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">24h spend</div>
            <div className="mt-1 break-words text-sm font-medium tabular-nums">
              {formatSolLamports(wallet.spend24hLamports)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">7d runway</div>
            <div className="mt-1 break-words text-sm font-medium tabular-nums">
              {formatRunway(wallet.runwayHours)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {wallet.roles.map((role) => (
            <Badge className="text-[11px]" key={role.key} variant="outline">
              {role.label}
            </Badge>
          ))}
          {wallet.mismatch ? (
            <Badge variant="secondary">Configuration mismatch</Badge>
          ) : null}
        </div>

        {wallet.mismatch ? (
          <p className="break-all text-xs text-muted-foreground">
            Configured: {wallet.configuredAddresses.join(", ") || "none"}
            <br />
            Observed: {wallet.observedAddresses.join(", ") || "none"}
            <br />
            Verify this rotation before funding.
          </p>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          {wallet.balanceObservedAt
            ? `${
                wallet.balanceError ? `${wallet.balanceError}. ` : ""
              }Observed ${new Intl.DateTimeFormat("en-US", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "UTC",
              }).format(new Date(wallet.balanceObservedAt))} UTC${
                wallet.balanceSlot
                  ? ` at slot ${wallet.balanceSlot.toLocaleString("en-US")}`
                  : ""
              }.`
            : wallet.balanceError ?? "Balance observation unavailable."}
        </p>
      </CardContent>
    </Card>
  );
}

function OperationalWallets({ data }: { data: EarnFundingData }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">Operational wallets</h2>
        <p className="text-sm text-muted-foreground">
          Public funding identities and confirmed mainnet SOL balances for
          sponsorship, policy execution, and gasless deployment
        </p>
      </div>
      {data.sourceErrors.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {data.sourceErrors.join(" ")}
        </div>
      ) : null}

      {data.wallets.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.wallets.map((wallet) => (
            <OperationalWalletCard key={wallet.address} wallet={wallet} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border px-3 py-4 text-sm text-muted-foreground">
          No operational wallet addresses were configured or observed.
        </div>
      )}

      {data.missingRoles.length > 0 ? (
        <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          Missing roles:{" "}
          {data.missingRoles.map((role) => role.label).join(", ")}
        </div>
      ) : null}

      <OperationalWalletSpendingCharts
        events={data.spendEvents}
        sourceErrors={data.spendSourceErrors}
        wallets={data.wallets}
        window={data.spendWindow}
      />
    </div>
  );
}

function getTopPositionWarningCount(
  position: EarnData["topPositions"][number]
) {
  return (
    position.missingManagedVaultRows +
    position.missingRedeemableMetadataRows +
    position.unknownReserveSemanticsRows
  );
}

function FlowTable({
  points,
  unit,
}: {
  points: EarnFlowPoint[];
  unit: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Deposits</TableHead>
          <TableHead className="text-right">Withdrawals</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points
          .slice()
          .reverse()
          .map((point) => (
            <TableRow key={point.date}>
              <TableCell className="font-medium">
                {formatDate(point.date)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCompactStablecoinRaw(point.depositedRaw, unit)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCompactStablecoinRaw(point.withdrawnRaw, unit)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCompactStablecoinRaw(point.netRaw, unit)}
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}

function PositionSortHead({
  align = "right",
  currentSort,
  selectedMint,
  sortKey,
}: {
  align?: "left" | "right";
  currentSort: PositionSortState;
  selectedMint: EarnStablecoinSymbol | null;
  sortKey: PositionSortKey;
}) {
  const active = currentSort.key === sortKey;
  const nextDirection =
    active && currentSort.direction === "desc" ? "asc" : "desc";
  const Icon = active
    ? currentSort.direction === "desc"
      ? ArrowDown
      : ArrowUp
    : ArrowUpDown;
  const label = POSITION_SORT_LABELS[sortKey];

  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <Link
        className={`inline-flex items-center gap-1 whitespace-nowrap ${
          align === "right" ? "justify-end" : ""
        }`}
        href={`?positionSort=${sortKey}&positionDirection=${nextDirection}${
          selectedMint ? `&mint=${selectedMint}` : ""
        }`}
      >
        <span>{label}</span>
        <Icon aria-hidden="true" className="size-3.5" />
      </Link>
    </TableHead>
  );
}

function StablecoinFilter({
  selectedMint,
}: {
  selectedMint: EarnStablecoinSymbol | null;
}) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Stablecoin filter">
      <Link href="?">
        <Badge variant={selectedMint === null ? "default" : "outline"}>
          All
        </Badge>
      </Link>
      {EARN_STABLECOIN_DESCRIPTORS.map((stablecoin) => (
        <Link href={`?mint=${stablecoin.symbol}`} key={stablecoin.mint}>
          <Badge
            variant={selectedMint === stablecoin.symbol ? "default" : "outline"}
          >
            {stablecoin.symbol}
          </Badge>
        </Link>
      ))}
    </div>
  );
}

function StablecoinHealthMatrix({ rows }: { rows: EarnStablecoinHealthRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold">Stablecoin health</CardTitle>
        <CardDescription>
          Mint-keyed verified reserve eligibility, holdings, confirmed flow, and
          latest execution history.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stablecoin</TableHead>
              <TableHead className="text-right">Eligible / best APY</TableHead>
              <TableHead className="text-right">Positions</TableHead>
              <TableHead className="text-right">Principal</TableHead>
              <TableHead className="text-right">Reserve / idle</TableHead>
              <TableHead className="text-right">30d in / out</TableHead>
              <TableHead>Latest rebalance</TableHead>
              <TableHead>Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.liquidityMint}>
                <TableCell>
                  <Link
                    className="font-semibold underline-offset-4 hover:underline"
                    href={`?mint=${row.symbol}`}
                  >
                    {row.symbol}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <AddressLink address={row.liquidityMint} />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <div>{formatNumber(row.eligibleReserveCount)}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.bestSupplyApyPercent === null
                      ? row.eligibilityReason
                      : `${row.bestSupplyApyPercent.toFixed(2)}%`}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.activePositionCount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCompactStablecoinRaw(
                    row.activePrincipalRaw,
                    row.symbol
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <div>
                    {formatCompactStablecoinRaw(
                      row.activeReserveRaw,
                      row.symbol
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCompactStablecoinRaw(row.activeIdleRaw, row.symbol)}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <div>
                    {formatCompactStablecoinRaw(
                      row.deposited30dRaw,
                      row.symbol
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCompactStablecoinRaw(
                      row.withdrawn30dRaw,
                      row.symbol
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDateTime(row.latestRebalanceAt)}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-64 flex-wrap gap-1">
                    {row.warnings.length === 0 ? (
                      <Badge variant="outline">Healthy</Badge>
                    ) : (
                      row.warnings.map((warning) => (
                        <Badge
                          key={warning.code}
                          title={warning.message}
                          variant={
                            warning.level === "critical"
                              ? "destructive"
                              : warning.level === "warning"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {warning.code.replaceAll("_", " ")}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function EarnDetailsContent({
  data,
  fundingData,
  fundingRef,
  activityReady,
  activityRef,
  positionsReady,
  positionsRef,
  positionSort,
  selectedMint,
  stablecoinHealth,
}: {
  data: EarnData;
  fundingData: EarnFundingData | null;
  fundingRef?: RefObject<HTMLDivElement | null>;
  activityReady: boolean;
  activityRef?: RefObject<HTMLDivElement | null>;
  positionsReady: boolean;
  positionsRef?: RefObject<HTMLDivElement | null>;
  stablecoinHealth: EarnStablecoinHealthRow[];
  positionSort: PositionSortState;
  selectedMint: EarnStablecoinSymbol | null;
}) {
  const selectedDescriptor = selectedMint
    ? getEarnStablecoinBySymbol(selectedMint)
    : null;
  const selectedSummary = selectedDescriptor
    ? data.stablecoins.find(
        (stablecoin) => stablecoin.liquidityMint === selectedDescriptor.mint
      )
    : null;
  const unit = amountUnit(selectedMint);
  const selectedPositions = selectedDescriptor
    ? data.topPositions.filter(
        (position) => position.depositMint === selectedDescriptor.mint
      )
    : data.topPositions;
  const sortedTopPositions = sortTopPositions(selectedPositions, positionSort);
  const flowPoints = aggregateFlowPoints(data.flow30d, selectedMint);
  const totalDeposited30dRaw =
    selectedSummary?.deposited30dRaw ?? data.totalDeposited30dRaw;
  const totalWithdrawn30dRaw =
    selectedSummary?.withdrawn30dRaw ?? data.totalWithdrawn30dRaw;
  const netFlow30dRaw = totalDeposited30dRaw - totalWithdrawn30dRaw;
  const activeReserveRaw =
    selectedSummary?.activeReserveRaw ?? data.activeReserveRaw;
  const activeIdleRaw = selectedSummary?.activeIdleRaw ?? data.activeIdleRaw;
  const activePointerDeltaRaw =
    selectedSummary?.currentPointerDeltaRaw ??
    data.activeCurrentPointerDeltaRaw;
  const activeStoredCurrentPointerRaw =
    selectedSummary?.activeStoredCurrentPointerRaw ??
    data.activeStoredCurrentPointerRaw;
  const activeExcludedReserveRaw =
    selectedSummary?.activeExcludedReserveRaw ?? data.activeExcludedReserveRaw;
  const formatSelectedAmount = (raw: bigint) =>
    formatCompactStablecoinRaw(raw, unit);
  const activeHoldingWarningCount =
    data.activeMissingManagedVaultRows +
    data.activeMissingRedeemableMetadataRows +
    data.activeUnknownReserveSemanticsRows;

  return (
    <>
      <div className="space-y-6">
        <StablecoinFilter selectedMint={selectedMint} />
        <StablecoinHealthMatrix rows={stablecoinHealth} />
        <div
          className={fundingData ? undefined : "h-[1800px]"}
          data-progressive-section="earn-funding"
          data-progressive-state={fundingData ? "ready" : "loading"}
          ref={fundingRef}
        >
          {fundingData ? (
            <OperationalWallets data={fundingData} />
          ) : (
            <ProgressiveSkeleton className="h-[1800px]" />
          )}
        </div>

        <div
          className={activityReady ? undefined : "min-h-[2200px]"}
          data-progressive-section="earn-activity"
          data-progressive-state={activityReady ? "ready" : "loading"}
          ref={activityRef}
        >
          {activityReady ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-bold">AUM breakdown</CardTitle>
                    <CardDescription>
                      Normalized active reserve value plus idle vault
                      stablecoins
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-md border px-3 py-2">
                        <div className="text-sm text-muted-foreground">
                          Reserve redeemable
                        </div>
                        <div className="mt-1 font-semibold tabular-nums">
                          {formatSelectedAmount(activeReserveRaw)}
                        </div>
                      </div>
                      <div className="rounded-md border px-3 py-2">
                        <div className="text-sm text-muted-foreground">
                          Idle vault stablecoins
                        </div>
                        <div className="mt-1 font-semibold tabular-nums">
                          {formatSelectedAmount(activeIdleRaw)}
                        </div>
                      </div>
                      <div className="rounded-md border px-3 py-2">
                        <div className="text-sm text-muted-foreground">
                          Stored current pointer
                        </div>
                        <div className="mt-1 font-semibold tabular-nums">
                          {formatSelectedAmount(activeStoredCurrentPointerRaw)}
                        </div>
                      </div>
                      <div className="rounded-md border px-3 py-2">
                        <div className="text-sm text-muted-foreground">
                          Pointer delta
                        </div>
                        <div className="mt-1 font-semibold tabular-nums">
                          {formatSelectedAmount(activePointerDeltaRaw)}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="font-bold">
                      Holding data quality
                    </CardTitle>
                    <CardDescription>
                      Reserve semantics accepted, converted, or excluded from
                      AUM
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Redeemable reserve rows
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatNumber(data.activeRedeemableReserveRows)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Collateral rows converted
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatNumber(data.activeCollateralReserveRows)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Warning rows
                      </span>
                      <Badge
                        variant={
                          activeHoldingWarningCount > 0
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {formatNumber(activeHoldingWarningCount)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Excluded reserve raw
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatSelectedAmount(activeExcludedReserveRaw)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardDescription>30d deposits</CardDescription>
                    <CardTitle className="text-2xl font-bold tabular-nums">
                      {formatSelectedAmount(totalDeposited30dRaw)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>30d withdrawals</CardDescription>
                    <CardTitle className="text-2xl font-bold tabular-nums">
                      {formatSelectedAmount(totalWithdrawn30dRaw)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>30d net flow</CardDescription>
                    <CardTitle className="text-2xl font-bold tabular-nums">
                      {formatSelectedAmount(netFlow30dRaw)}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-bold">Confirmed flow</CardTitle>
                    <CardDescription>
                      Daily confirmed Earn deposits and withdrawals
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FlowTable points={flowPoints} unit={unit} />
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-bold">
                        Autodeposit status
                      </CardTitle>
                      <CardDescription>
                        Active requires policy active, target active, and active
                        lifecycle
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {Object.entries(data.autodepositStatusCounts).map(
                          ([status, count]) => (
                            <div
                              className="rounded-md border px-3 py-2"
                              key={status}
                            >
                              <div className="text-sm text-muted-foreground capitalize">
                                {status}
                              </div>
                              <div className="mt-1 text-xl font-semibold tabular-nums">
                                {formatNumber(count)}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="font-bold">
                        Scheduled sweeps
                      </CardTitle>
                      <CardDescription>
                        Open surplus lots remaining for active Autodeposit
                        targets
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">
                            Open
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {formatNominalUsdRaw(data.scheduledOpenAmountRaw)}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {formatNumber(data.scheduledOpenLotCount)} lots
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">
                            Eligible now
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {formatNominalUsdRaw(
                              data.scheduledEligibleAmountRaw
                            )}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {formatNumber(data.scheduledEligibleLotCount)} lots
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="font-bold">
                        Executed sweeps
                      </CardTitle>
                      <CardDescription>
                        Confirmed rows from balance sweep executions
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">
                            All time
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {formatNominalUsdRaw(
                              data.autodepositExecutionAmountRaw
                            )}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {formatNumber(data.autodepositExecutionCount)}{" "}
                          executions
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">
                            30d
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {formatNominalUsdRaw(
                              data.autodepositExecutionAmount30dRaw
                            )}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {formatNumber(data.autodepositExecutionCount30d)}{" "}
                          executions
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="font-bold">Data freshness</CardTitle>
                  <CardDescription>
                    Latest timestamps from Yield Neon accounting and worker-fed
                    state
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.freshness.map((metric) => (
                      <div
                        className="rounded-md border px-3 py-2"
                        key={metric.label}
                      >
                        <div className="text-sm text-muted-foreground">
                          {metric.label}
                        </div>
                        <div className="mt-1 font-medium tabular-nums">
                          {formatDateTime(metric.timestamp)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <ProgressiveSkeleton className="min-h-[2200px]" />
          )}
        </div>

        <div
          className={positionsReady ? undefined : "h-[1200px]"}
          data-progressive-section="earn-positions"
          data-progressive-state={positionsReady ? "ready" : "loading"}
          ref={positionsRef}
        >
          {positionsReady ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-bold">
                  Largest active positions
                </CardTitle>
                <CardDescription>
                  Active positions ordered by{" "}
                  {POSITION_SORT_LABELS[positionSort.key].toLowerCase()},
                  {positionSort.direction === "asc"
                    ? " low to high"
                    : " high to low"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Wallet</TableHead>
                      <TableHead>Settings</TableHead>
                      <TableHead>Mint</TableHead>
                      <TableHead>Reserve</TableHead>
                      <PositionSortHead
                        currentSort={positionSort}
                        selectedMint={selectedMint}
                        sortKey="normalized"
                      />
                      <PositionSortHead
                        currentSort={positionSort}
                        selectedMint={selectedMint}
                        sortKey="reserve"
                      />
                      <PositionSortHead
                        currentSort={positionSort}
                        selectedMint={selectedMint}
                        sortKey="idle"
                      />
                      <PositionSortHead
                        currentSort={positionSort}
                        selectedMint={selectedMint}
                        sortKey="principal"
                      />
                      <PositionSortHead
                        currentSort={positionSort}
                        selectedMint={selectedMint}
                        sortKey="pointerDelta"
                      />
                      <PositionSortHead
                        currentSort={positionSort}
                        selectedMint={selectedMint}
                        sortKey="warnings"
                      />
                      <PositionSortHead
                        currentSort={positionSort}
                        selectedMint={selectedMint}
                        sortKey="observed"
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTopPositions.length === 0 ? (
                      <TableRow>
                        <TableCell
                          className="text-muted-foreground"
                          colSpan={11}
                        >
                          No active Earn positions found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedTopPositions.map((position) => (
                        <TableRow
                          key={`${position.settings}-${position.depositMint}-${position.currentReserve}`}
                        >
                          <TableCell>
                            <AddressLink address={position.walletAddress} />
                          </TableCell>
                          <TableCell>
                            <AddressLink address={position.settings} />
                          </TableCell>
                          <TableCell className="font-medium">
                            {getEarnStablecoinSymbol(position.depositMint) ??
                              "Unknown"}
                          </TableCell>
                          <TableCell>
                            <AddressLink address={position.currentReserve} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCompactStablecoinRaw(
                              position.normalizedAumRaw,
                              getEarnStablecoinSymbol(position.depositMint) ??
                                "stablecoins"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCompactStablecoinRaw(
                              position.normalizedReserveRaw,
                              getEarnStablecoinSymbol(position.depositMint) ??
                                "stablecoins"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCompactStablecoinRaw(
                              position.idleAmountRaw,
                              getEarnStablecoinSymbol(position.depositMint) ??
                                "stablecoins"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCompactStablecoinRaw(
                              position.principalAmountRaw,
                              getEarnStablecoinSymbol(position.depositMint) ??
                                "stablecoins"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCompactStablecoinRaw(
                              position.currentPointerDeltaRaw,
                              getEarnStablecoinSymbol(position.depositMint) ??
                                "stablecoins"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Badge
                              variant={
                                getTopPositionWarningCount(position) > 0
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {formatNumber(
                                getTopPositionWarningCount(position)
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatDateTime(position.currentObservedAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <ProgressiveSkeleton className="h-[1200px]" />
          )}
        </div>
      </div>
    </>
  );
}

export function EarnDetailsFallback() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold">Loading live diagnostics</CardTitle>
        <CardDescription>
          Headline stats are ready. Canonical Yield Neon details are loading
          separately.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export function getSnapshotDescription(
  label: string,
  snapshot: AdminEarnSnapshot | null
) {
  if (!snapshot) {
    return `${label} · snapshot unavailable`;
  }
  if (snapshot.state === "stale") {
    return `${label} · stale since ${formatDateTime(snapshot.refreshedAt)}`;
  }
  return label;
}

export function EarnSnapshotStats({
  snapshot,
}: {
  snapshot: AdminEarnSnapshot | null;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <StatCard
        description={getSnapshotDescription(
          "Current Earn AUM (normalized)",
          snapshot
        )}
        title={
          snapshot ? formatNominalUsdRaw(snapshot.activeAumRaw) : "Unavailable"
        }
      />
      <StatCard
        description={getSnapshotDescription("Deposited principal", snapshot)}
        title={
          snapshot
            ? formatNominalUsdRaw(snapshot.activePrincipalRaw)
            : "Unavailable"
        }
      />
      <StatCard
        description={getSnapshotDescription("Unique Earn users", snapshot)}
        title={
          snapshot ? formatNumber(snapshot.uniqueEarnUsers) : "Unavailable"
        }
      />
      <StatCard
        description={getSnapshotDescription("Active Earn policies", snapshot)}
        title={
          snapshot ? formatNumber(snapshot.uniqueEarnPolicies) : "Unavailable"
        }
      />
      <StatCard
        description={getSnapshotDescription("Active Autodeposit", snapshot)}
        title={
          snapshot
            ? formatNumber(snapshot.activeAutodepositPolicies)
            : "Unavailable"
        }
      />
    </div>
  );
}
