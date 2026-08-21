import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { RebalanceMonitorClient } from "./rebalance-monitor-client";

export const dynamic = "force-dynamic";

export default function EarnRebalancePage() {
  return (
    <PageContainer style={{ overflowAnchor: "none" }}>
      <SectionHeader
        breadcrumbs={[{ href: "/earn", label: "Earn" }, { label: "Rebalance" }]}
        subtitle="Stablecoin Safe reserve APY and optimizer decision monitoring"
        title="Rebalance"
      />

      <RebalanceMonitorClient />
    </PageContainer>
  );
}
