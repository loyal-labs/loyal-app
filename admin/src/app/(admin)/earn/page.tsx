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
import { getEarnData, USDC_DECIMALS, type EarnFlowPoint } from "./earn-data";

export const dynamic = "force-dynamic";

const SOLANA_ENV = "mainnet";

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

export default async function EarnPage() {
  const data = await getEarnData();
  const netFlow30dRaw = data.totalDeposited30dRaw - data.totalWithdrawn30dRaw;

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
            description="Current Earn AUM"
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
                Daily deposits and withdrawals from confirmed Earn event tables
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
              Active user yield positions ordered by current amount
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Settings</TableHead>
                  <TableHead>Reserve</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Observed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topPositions.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={6}>
                      No active Earn positions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.topPositions.map((position) => (
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
                        {formatCompactUsdcRaw(position.currentAmountRaw)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactUsdcRaw(position.principalAmountRaw)}
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
