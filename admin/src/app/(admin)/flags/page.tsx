import { asc } from "drizzle-orm";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { getDatabase } from "@/lib/core/database";
import { runtimeFlags } from "@loyal-labs/db-core/schema";

import { FlagForm } from "./flag-form";
import { FlagList } from "./flag-list";

export const dynamic = "force-dynamic";

export default async function FlagsPage() {
  const db = getDatabase();
  const flags = await db.query.runtimeFlags.findMany({
    orderBy: [asc(runtimeFlags.key)],
    with: {
      featureLinks: {
        with: {
          feature: true,
        },
      },
    },
  });

  const serializedFlags = flags.map((flag) => ({
    id: flag.id,
    key: flag.key,
    description: flag.description,
    enabled: flag.enabled,
    audience: flag.audience,
    targetEnvironments: flag.targetEnvironments,
    notes: flag.notes,
    linkedFeatures: flag.featureLinks.map((link) => ({
      id: link.feature.id,
      title: link.feature.title,
      key: link.feature.key,
    })),
  }));

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Flags"
        breadcrumbs={[{ label: "Flags" }]}
        subtitle="Manage frontend runtime flags for the Loyal web app."
      />

      <FlagForm />
      <FlagList flags={serializedFlags} />
    </PageContainer>
  );
}
