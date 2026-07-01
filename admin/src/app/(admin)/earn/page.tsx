import { AddressLink } from "@/components/blockchain/address-link";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
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
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import {
  getEarnData,
  USDC_DECIMALS,
  type EarnFlowPoint,
  type EarnPositionRow,
} from "./earn-data";

export const dynamic = "force-dynamic";

const SOLANA_ENV = "mainnet";
const POSITION_SORT_LABELS = {
  idle: "Idle USDC",
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
  positionDirection?: string | string[];
  positionSort?: string | string[];
};

const DEFAULT_POSITION_SORT: PositionSortState = {
  direction: "desc",
  key: "normalized",
};

function formatUsdcRaw(raw: bigint) {
  const zero = BigInt(0);
  const divisor = BigInt(10) ** BigInt(USDC_DECIMALS);
  const sign = raw < zero ? "-" : "";
  const absolute = raw < zero ? -raw : raw;
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const fractionText = fraction.toString().padStart(USDC_DECIMALS, "0");
  const trimmedFraction = fractionText.replace(/0+$/, "");
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign}${wholeText}${
    trimmedFraction ? `.${trimmedFraction}` : ""
  } USDC`;
}

function formatCompactUsdcRaw(raw: bigint) {
  const zero = BigInt(0);
  const centScale = BigInt(10) ** BigInt(USDC_DECIMALS - 2);
  const sign = raw < zero ? "-" : "";
  const absolute = raw < zero ? -raw : raw;
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
      return getTopPositionWarningCount(left) - getTopPositionWarningCount(right);
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

function getTopPositionWarningCount(
  position: Awaited<ReturnType<typeof getEarnData>>["topPositions"][number]
) {
  return (
    position.missingManagedVaultRows +
    position.missingRedeemableMetadataRows +
    position.unknownReserveSemanticsRows
  );
}

function FlowTable({ points }: { points: EarnFlowPoint[] }) {
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
                {formatCompactUsdcRaw(point.depositedRaw)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCompactUsdcRaw(point.withdrawnRaw)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCompactUsdcRaw(point.netRaw)}
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
  sortKey,
}: {
  align?: "left" | "right";
  currentSort: PositionSortState;
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
        href={`?positionSort=${sortKey}&positionDirection=${nextDirection}`}
      >
        <span>{label}</span>
        <Icon aria-hidden="true" className="size-3.5" />
      </Link>
    </TableHead>
  );
}

export default async function EarnPage({
  searchParams,
}: {
  searchParams?: Promise<EarnPageSearchParams>;
}) {
  const data = await getEarnData();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const positionSort = parsePositionSort(resolvedSearchParams);
  const sortedTopPositions = sortTopPositions(data.topPositions, positionSort);
  const netFlow30dRaw = data.totalDeposited30dRaw - data.totalWithdrawn30dRaw;
  const activeHoldingWarningCount =
    data.activeMissingManagedVaultRows +
    data.activeMissingRedeemableMetadataRows +
    data.activeUnknownReserveSemanticsRows;

  return (
    <PageContainer>
      <SectionHeader
        breadcrumbs={[{ label: "Earn" }]}
        subtitle="Internal Yield Neon monitoring for Earn positions and autodeposit health"
        title="Earn"
      />

      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard
            description="Current Earn AUM (normalized)"
            title={formatCompactUsdcRaw(data.activeAumRaw)}
          />
          <StatCard
            description="Deposited principal"
            title={formatCompactUsdcRaw(data.activePrincipalRaw)}
          />
          <StatCard
            description="Unique Earn users"
            title={formatNumber(data.uniqueEarnUsers)}
          />
          <StatCard
            description="Active Earn policies"
            title={formatNumber(data.uniqueEarnPolicies)}
          />
          <StatCard
            description="Active Autodeposit"
            title={formatNumber(data.activeAutodepositPolicies)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="font-bold">AUM breakdown</CardTitle>
              <CardDescription>
                Normalized active reserve value plus idle vault USDC
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border px-3 py-2">
                  <div className="text-sm text-muted-foreground">
                    Reserve redeemable
                  </div>
                  <div className="mt-1 font-semibold tabular-nums">
                    {formatCompactUsdcRaw(data.activeReserveRaw)}
                  </div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-sm text-muted-foreground">
                    Idle vault USDC
                  </div>
                  <div className="mt-1 font-semibold tabular-nums">
                    {formatCompactUsdcRaw(data.activeIdleRaw)}
                  </div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-sm text-muted-foreground">
                    Stored current pointer
                  </div>
                  <div className="mt-1 font-semibold tabular-nums">
                    {formatCompactUsdcRaw(data.activeStoredCurrentPointerRaw)}
                  </div>
                </div>
                <div className="rounded-md border px-3 py-2">
                  <div className="text-sm text-muted-foreground">
                    Pointer delta
                  </div>
                  <div className="mt-1 font-semibold tabular-nums">
                    {formatCompactUsdcRaw(data.activeCurrentPointerDeltaRaw)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-bold">Holding data quality</CardTitle>
              <CardDescription>
                Reserve semantics accepted, converted, or excluded from AUM
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
                    activeHoldingWarningCount > 0 ? "destructive" : "outline"
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
                  {formatCompactUsdcRaw(data.activeExcludedReserveRaw)}
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
                {formatCompactUsdcRaw(data.totalDeposited30dRaw)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>30d withdrawals</CardDescription>
              <CardTitle className="text-2xl font-bold tabular-nums">
                {formatCompactUsdcRaw(data.totalWithdrawn30dRaw)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>30d net flow</CardDescription>
              <CardTitle className="text-2xl font-bold tabular-nums">
                {formatCompactUsdcRaw(netFlow30dRaw)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="font-bold">Confirmed flow</CardTitle>
              <CardDescription>
                Daily confirmed deposits, Autodeposit sweeps, and withdrawals
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FlowTable points={data.flow30d} />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="font-bold">Autodeposit status</CardTitle>
                <CardDescription>
                  Active requires policy active, target active, and active
                  lifecycle
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(data.autodepositStatusCounts).map(
                    ([status, count]) => (
                      <div className="rounded-md border px-3 py-2" key={status}>
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
                <CardTitle className="font-bold">Scheduled sweeps</CardTitle>
                <CardDescription>
                  Open surplus lots remaining for active Autodeposit targets
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Open</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {formatCompactUsdcRaw(data.scheduledOpenAmountRaw)}
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
                      {formatCompactUsdcRaw(data.scheduledEligibleAmountRaw)}
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
                <CardTitle className="font-bold">Executed sweeps</CardTitle>
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
                      {formatCompactUsdcRaw(data.autodepositExecutionAmountRaw)}
                    </div>
                  </div>
                  <Badge variant="outline">
                    {formatNumber(data.autodepositExecutionCount)} executions
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">30d</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {formatCompactUsdcRaw(
                        data.autodepositExecutionAmount30dRaw
                      )}
                    </div>
                  </div>
                  <Badge variant="outline">
                    {formatNumber(data.autodepositExecutionCount30d)} executions
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
              Latest timestamps from Yield Neon accounting and worker-fed state
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.freshness.map((metric) => (
                <div className="rounded-md border px-3 py-2" key={metric.label}>
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

        <Card>
          <CardHeader>
            <CardTitle className="font-bold">
              Largest active positions
            </CardTitle>
            <CardDescription>
              Active positions ordered by{" "}
              {POSITION_SORT_LABELS[positionSort.key].toLowerCase()},
              {positionSort.direction === "asc" ? " low to high" : " high to low"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Settings</TableHead>
                  <TableHead>Reserve</TableHead>
                  <PositionSortHead
                    currentSort={positionSort}
                    sortKey="normalized"
                  />
                  <PositionSortHead
                    currentSort={positionSort}
                    sortKey="reserve"
                  />
                  <PositionSortHead currentSort={positionSort} sortKey="idle" />
                  <PositionSortHead
                    currentSort={positionSort}
                    sortKey="principal"
                  />
                  <PositionSortHead
                    currentSort={positionSort}
                    sortKey="pointerDelta"
                  />
                  <PositionSortHead
                    currentSort={positionSort}
                    sortKey="warnings"
                  />
                  <PositionSortHead
                    currentSort={positionSort}
                    sortKey="observed"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTopPositions.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={10}>
                      No active Earn positions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedTopPositions.map((position) => (
                    <TableRow
                      key={`${position.settings}-${position.currentReserve}`}
                    >
                      <TableCell>
                        <AddressLink
                          address={position.walletAddress}
                          solanaEnv={SOLANA_ENV}
                        />
                      </TableCell>
                      <TableCell>
                        <AddressLink
                          address={position.settings}
                          solanaEnv={SOLANA_ENV}
                        />
                      </TableCell>
                      <TableCell>
                        <AddressLink
                          address={position.currentReserve}
                          solanaEnv={SOLANA_ENV}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactUsdcRaw(position.normalizedAumRaw)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactUsdcRaw(position.normalizedReserveRaw)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactUsdcRaw(position.idleAmountRaw)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactUsdcRaw(position.principalAmountRaw)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactUsdcRaw(position.currentPointerDeltaRaw)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Badge
                          variant={
                            getTopPositionWarningCount(position) > 0
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {formatNumber(getTopPositionWarningCount(position))}
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
      </div>
    </PageContainer>
  );
}
