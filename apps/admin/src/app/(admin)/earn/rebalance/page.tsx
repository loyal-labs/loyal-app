import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { loadRebalancePageData } from "../../../api/earn/rebalance/route";

import { RebalanceMonitorClient } from "./rebalance-monitor-client";

export const dynamic = "force-dynamic";

export default async function EarnRebalancePage() {
  const initialData = await loadRebalancePageData();

  return (
    <PageContainer>
      <SectionHeader
        breadcrumbs={[{ href: "/earn", label: "Earn" }, { label: "Rebalance" }]}
        subtitle="Stablecoin Safe reserve APY and optimizer decision monitoring"
        title="Rebalance"
      />

      <RebalanceMonitorClient initialData={initialData} />
    </PageContainer>
  );
}
