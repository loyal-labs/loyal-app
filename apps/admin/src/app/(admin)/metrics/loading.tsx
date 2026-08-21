import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { MetricsLoadingSkeleton } from "./metrics-loading-skeleton";

export default function MetricsLoading() {
  return (
    <PageContainer className="max-w-7xl">
      <SectionHeader
        title="Metrics"
        breadcrumbs={[{ label: "Metrics" }]}
        subtitle="Production p95 latency in two-hour UTC buckets over the last 7 days, busiest operations first."
      />
      <MetricsLoadingSkeleton />
    </PageContainer>
  );
}
