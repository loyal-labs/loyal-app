import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { AutodepositActivityChart } from "./autodeposit-activity-chart";
import { OptimizationVolumeChart } from "./optimization-volume-chart";
import { getOverviewData } from "./overview-data";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { autodeposit, optimizationVolume } = await getOverviewData();

  return (
    <PageContainer>
      <SectionHeader title="Overview" breadcrumbs={[{ label: "Overview" }]} />
      <div className="mx-auto grid w-full max-w-4xl gap-6">
        <OptimizationVolumeChart data={optimizationVolume} />
        <AutodepositActivityChart data={autodeposit} />
      </div>
    </PageContainer>
  );
}
