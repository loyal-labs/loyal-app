import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { getMetricsData } from "./metrics-data";
import { MetricsDashboard } from "./metrics-dashboard";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const data = await getMetricsData();

  return (
    <PageContainer className="max-w-7xl">
      <SectionHeader
        title="Metrics"
        breadcrumbs={[{ label: "Metrics" }]}
        subtitle="Production p95 latency in two-hour UTC buckets over the last 7 days, busiest operations first."
      />
      <MetricsDashboard data={data} />
    </PageContainer>
  );
}
