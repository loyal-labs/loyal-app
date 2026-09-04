import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdminSession } from "@/lib/require-admin-session";
import { RecentRegistrationsTable } from "./recent-registrations-table";
import { SmartAccountCreationsChart } from "./smart-account-creations-chart";
import { SmartAccountSponsorshipSpendChart } from "./smart-account-sponsorship-spend-chart";
import { getSmartAccountsData } from "./smart-accounts-data";

export const dynamic = "force-dynamic";

export default async function SmartAccountsPage() {
  await requireAdminSession();

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
            <RecentRegistrationsTable registrations={registrations} />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
