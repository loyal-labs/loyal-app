import { AddressLink } from "@/components/blockchain/address-link";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { Badge } from "@/components/ui/badge";
import { requireAdminSession } from "@/lib/require-admin-session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReactNode } from "react";

import { getAutonomousVaultData } from "./autonomous-vault-data";

export const dynamic = "force-dynamic";

const TOKEN_SCALE = BigInt(1_000_000);

function formatUsdcValue(raw: bigint) {
  const roundedCents = (raw + BigInt(5_000)) / BigInt(10_000);
  const whole = roundedCents / BigInt(100);
  const cents = roundedCents % BigInt(100);

  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents
    .toString()
    .padStart(2, "0")} USDC`;
}

function formatToken(raw: bigint, symbol: string) {
  const whole = raw / TOKEN_SCALE;
  const fraction = (raw % TOKEN_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");

  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${
    fraction ? `.${fraction}` : ""
  } ${symbol}`;
}

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function ValueCard({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card className="h-full gap-4">
      <CardHeader>
        <CardDescription>{description}</CardDescription>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default async function AutonomousVaultPage() {
  await requireAdminSession();

  const data = await getAutonomousVaultData();

  return (
    <PageContainer className="max-w-6xl">
      <SectionHeader
        breadcrumbs={[
          { href: "/earn", label: "Earn" },
          { label: "Autonomous vault" },
        ]}
        subtitle="Current mainnet balances, with USDC and LOYAL kept separate"
        title="Autonomous vault"
      />

      {!data.available ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="destructive">Unavailable</Badge>
              <CardTitle className="text-base">
                Live snapshot could not be verified
              </CardTitle>
            </div>
            <CardDescription>
              {formatObservedAt(data.observedAt)} UTC
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{data.error}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card className="gap-4">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <CardDescription>USDC held or redeemable</CardDescription>
                  <CardTitle className="text-3xl font-semibold tabular-nums tracking-tight">
                    {formatUsdcValue(data.totalUsdcRaw)}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {formatToken(data.totalLoyalRaw, "LOYAL")} tracked
                    separately · no LOYAL spot-price conversion included
                  </p>
                </div>
                <Badge
                  variant={
                    data.status === "healthy" ? "outline" : "destructive"
                  }
                >
                  {data.status === "healthy" ? "Healthy" : "Needs attention"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span>{formatUsdcValue(data.deployedUsdcRaw)} in protocols</span>
              <span>
                Finalized slot {data.observedSlot.toLocaleString("en-US")}
              </span>
              <span>{formatObservedAt(data.observedAt)} UTC</span>
              <span>
                Vault <AddressLink address={data.vault} />
              </span>
            </CardContent>
          </Card>

          <section className="grid gap-4 md:grid-cols-3">
            <ValueCard description="Redeemable USDC" title="Kamino Earn">
              <p className="text-2xl font-semibold tabular-nums tracking-tight">
                {formatUsdcValue(data.kamino.valueUsdcRaw)}
              </p>
              <p className="text-sm text-muted-foreground">
                Current Main-market obligation value.
              </p>
              <p className="text-xs text-muted-foreground">
                Reserve <AddressLink address={data.kamino.reserve} />
              </p>
            </ValueCard>

            <ValueCard
              description="USDC and LOYAL shown separately"
              title="Meteora LP"
            >
              <div className="space-y-1 tabular-nums">
                <p className="text-xl font-semibold">
                  {formatToken(data.meteora.usdcRaw, "USDC")}
                </p>
                <p className="text-xl font-semibold">
                  {formatToken(data.meteora.loyalRaw, "LOYAL")}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Pool reference: 1 LOYAL ={" "}
                {data.meteora.priceUsdcPerLoyal.toFixed(6)} USDC · Active bin{" "}
                {data.meteora.activeBin}
              </p>
              <p className="text-xs text-muted-foreground">
                Reference price is not applied to the headline total · Includes
                claimable fees · Position{" "}
                <AddressLink address={data.meteora.position} />
              </p>
            </ValueCard>

            <ValueCard
              description="Assets not deployed to a protocol"
              title="Held in vault"
            >
              <div className="space-y-1 tabular-nums">
                <p className="text-xl font-semibold">
                  {formatToken(data.idle.usdcRaw, "USDC")}
                </p>
                <p className="text-xl font-semibold">
                  {formatToken(data.idle.loyalRaw, "LOYAL")}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Remaining LOYAL is intentionally unallocated.
              </p>
            </ValueCard>
          </section>

          <p className="text-xs leading-relaxed text-muted-foreground">
            The USDC headline includes only USDC held directly, redeemable from
            Kamino, or currently present in the Meteora position. LOYAL is never
            converted at the pool&apos;s spot price for the headline because
            that price does not establish a realizable value for the full
            inventory.
          </p>
        </div>
      )}
    </PageContainer>
  );
}
