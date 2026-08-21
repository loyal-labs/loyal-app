import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { EarnRebalanceLatency } from "./earn-rebalance-latency";
import { getEarnRebalanceLatencyData } from "./earn-rebalance-latency-data";
import { MetricsLatencySkeleton } from "./metrics-loading-skeleton";
import { MetricsDashboardProgressive } from "./metrics-progressive-page";

export const dynamic = "force-dynamic";

async function MetricsLatencySection() {
  const data = await getEarnRebalanceLatencyData();

  return (
    <section
      data-progressive-section="metrics-latency"
      data-progressive-state="ready"
    >
      <EarnRebalanceLatency data={data} />
    </section>
  );
}

export default function MetricsPage() {
  return (
    <PageContainer className="max-w-7xl">
      <SectionHeader
        title="Metrics"
        breadcrumbs={[{ label: "Metrics" }]}
        subtitle="Production p95 latency in two-hour UTC buckets over the last 7 days, busiest operations first."
      />
      <div className="space-y-10" data-progressive-page="/metrics">
        <Suspense
          fallback={
            <section
              data-progressive-section="metrics-latency"
              data-progressive-state="loading"
            >
              <MetricsLatencySkeleton />
            </section>
          }
        >
          <MetricsLatencySection />
        </Suspense>
        <MetricsDashboardProgressive />
      </div>
    </PageContainer>
  );
}
