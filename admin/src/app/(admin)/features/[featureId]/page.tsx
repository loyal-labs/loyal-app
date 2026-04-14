import { asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { getDatabase } from "@/lib/core/database";
import {
  featureAppStatuses,
  featureEvidence,
  featureFlagLinks,
  featureRegistry,
  runtimeFlags,
} from "@loyal-labs/db-core/schema";

import { FeatureDetail } from "./feature-detail";

export const dynamic = "force-dynamic";

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ featureId: string }>;
}) {
  const { featureId } = await params;
  const db = getDatabase();

  const feature = await db.query.featureRegistry.findFirst({
    where: eq(featureRegistry.id, featureId),
    with: {
      appStatuses: {
        orderBy: [asc(featureAppStatuses.app)],
        with: {
          evidence: {
            orderBy: [desc(featureEvidence.createdAt)],
          },
        },
      },
      flagLinks: {
        orderBy: [asc(featureFlagLinks.createdAt)],
        with: {
          flag: true,
        },
      },
    },
  });

  if (!feature) {
    notFound();
  }

  const availableFlags = await db.select().from(runtimeFlags).orderBy(asc(runtimeFlags.key));

  return (
    <PageContainer>
      <SectionHeader
        title={feature.title}
        breadcrumbs={[
          { label: "Features", href: "/features" },
          { label: feature.title },
        ]}
        subtitle={`Feature key: ${feature.key}`}
      />

      <FeatureDetail feature={feature} availableFlags={availableFlags} />
    </PageContainer>
  );
}
