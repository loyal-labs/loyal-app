import { AddressLink } from "@/components/blockchain/address-link";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
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
import { GaslessClaimsChart } from "./gasless-claims-chart";
import { ShieldUnshieldChart } from "./shield-unshield-chart";
import {
  getFaucetBalance,
  getGaslessClaimsData,
  getTransfersData,
} from "./transfers-data";

export const dynamic = "force-dynamic";

function formatUsd(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOptionalUsd(value: number | null) {
  return value === null ? "N/A" : formatUsd(value);
}

export default async function TransfersPage() {
  const [
    { assets, shieldPoints, totalShielded, totalUnshielded, tvl },
    { points: gaslessPoints, totalSpent },
    faucetBalance,
  ] = await Promise.all([
    getTransfersData(),
    getGaslessClaimsData(),
    getFaucetBalance(),
  ]);

  return (
    <PageContainer>
      <SectionHeader
        title="Transfers"
        breadcrumbs={[{ label: "Transfers" }]}
        subtitle="Smart contract analytics for private transfers and gasless claims"
      />

      <div className="space-y-6">
        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>TVL</CardDescription>
              <CardTitle className="text-2xl font-bold tabular-nums">
                {formatUsd(tvl)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Net flow (30d)</CardDescription>
              <CardTitle className="text-2xl font-bold tabular-nums">
                {formatUsd(totalShielded - totalUnshielded)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Gasless faucet balance</CardDescription>
              <CardTitle className="text-2xl font-bold tabular-nums">
                {faucetBalance !== null
                  ? `${faucetBalance.toLocaleString()} SOL`
                  : "N/A"}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Shield / Unshield chart */}
        <ShieldUnshieldChart
          data={shieldPoints}
          totalShielded={totalShielded}
          totalUnshielded={totalUnshielded}
        />

        {/* Gasless claims chart */}
        <GaslessClaimsChart data={gaslessPoints} totalSpent={totalSpent} />

        {/* Shielded assets table */}
        <Card>
          <CardHeader>
            <CardTitle className="font-bold">Shielded assets</CardTitle>
            <CardDescription>
              Breakdown of tokens currently held in program vaults
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Mint</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Total amount</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.tokenMint}>
                    <TableCell className="font-medium">
                      {asset.symbol}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <AddressLink address={asset.tokenMint} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {asset.userCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {asset.totalAmount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatOptionalUsd(asset.priceUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatOptionalUsd(asset.totalValueUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
