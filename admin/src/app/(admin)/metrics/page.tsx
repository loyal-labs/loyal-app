import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { EarnRebalanceLatency } from "./earn-rebalance-latency";
import { getEarnRebalanceLatencyData } from "./earn-rebalance-latency-data";
import { getMetricsData } from "./metrics-data";
import { MetricsDashboard } from "./metrics-dashboard";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const [data, earnRebalanceLatency] = await Promise.all([
    getMetricsData(),
    getEarnRebalanceLatencyData(),
  ]);

  return (
    <PageContainer className="max-w-7xl">
      <SectionHeader
        title="Metrics"
        breadcrumbs={[{ label: "Metrics" }]}
        subtitle="Production p95 latency in two-hour UTC buckets over the last 7 days, busiest operations first."
      />
      <div className="space-y-10">
        <EarnRebalanceLatency data={earnRebalanceLatency} />
        <MetricsDashboard data={data} />
      </div>
    </PageContainer>
  );
}
