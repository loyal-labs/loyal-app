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
import { SmartAccountCreationsChart } from "./smart-account-creations-chart";
import { SmartAccountSponsorshipSpendChart } from "./smart-account-sponsorship-spend-chart";
import { getSmartAccountsData } from "./smart-accounts-data";

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

function shortAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getSolscanAccountUrl(address: string, solanaEnv: string) {
  const params =
    solanaEnv === "mainnet" ? "" : `?cluster=${encodeURIComponent(solanaEnv)}`;

  return `https://solscan.io/account/${address}${params}`;
}

function formatRegistrationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "N/A" : dateTimeFormatter.format(date);
}

function AddressLink({
  address,
  solanaEnv,
}: {
  address: string;
  solanaEnv: string;
}) {
  return (
    <a
      className="font-mono underline underline-offset-2 hover:text-foreground/80"
      href={getSolscanAccountUrl(address, solanaEnv)}
      rel="noreferrer"
      target="_blank"
      title={address}
    >
      {shortAddress(address)}
    </a>
  );
}

export default async function SmartAccountsPage() {
  const {
    creationPoints,
    registrations,
    solPriceUsd,
    spendPoints,
    totalAccounts,
    totalCreated30d,
    totalSpentSol30d,
    totalSpentUsd30d,
  } = await getSmartAccountsData();

  return (
    <PageContainer>
      <SectionHeader
        breadcrumbs={[{ label: "Smart accounts" }]}
        subtitle="Creation and sponsorship analytics for Loyal web smart accounts"
        title="Smart accounts"
      />

      <div className="space-y-6">
        <SmartAccountCreationsChart
          data={creationPoints}
          totalAccounts={totalAccounts}
          totalCreated30d={totalCreated30d}
        />

        <SmartAccountSponsorshipSpendChart
          data={spendPoints}
          solPriceUsd={solPriceUsd}
          totalSpentSol30d={totalSpentSol30d}
          totalSpentUsd30d={totalSpentUsd30d}
        />

        <Card>
          <CardHeader>
            <CardTitle className="font-bold">Recent registrations</CardTitle>
            <CardDescription>
              Latest ready smart accounts and their owner/vault addresses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Registration date</TableHead>
                  <TableHead>User address</TableHead>
                  <TableHead>Vault address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registrations.length > 0 ? (
                  registrations.map((registration) => (
                    <TableRow key={registration.id}>
                      <TableCell className="tabular-nums">
                        {formatRegistrationDate(registration.registeredAt)}
                      </TableCell>
                      <TableCell>
                        <AddressLink
                          address={registration.userAddress}
                          solanaEnv={registration.solanaEnv}
                        />
                      </TableCell>
                      <TableCell>
                        {registration.vaultAddress ? (
                          <AddressLink
                            address={registration.vaultAddress}
                            solanaEnv={registration.solanaEnv}
                          />
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      className="py-8 text-center text-muted-foreground"
                      colSpan={3}
                    >
                      No smart account registrations found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
