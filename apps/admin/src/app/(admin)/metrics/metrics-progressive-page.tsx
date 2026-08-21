"use client";

import { MetricsDashboard } from "./metrics-dashboard";
import type { MetricsDashboardData } from "./metrics-data";
import { MetricsDashboardSkeleton } from "./metrics-loading-skeleton";
import { MetricsProgressiveSection } from "./metrics-progressive-section";

export function MetricsDashboardProgressive() {
  return (
    <MetricsProgressiveSection<MetricsDashboardData>
      endpoint="/api/metrics?section=dashboard"
      section="metrics-dashboard"
      skeleton={<MetricsDashboardSkeleton />}
    >
      {(data) => <MetricsDashboard data={data} />}
    </MetricsProgressiveSection>
  );
}
