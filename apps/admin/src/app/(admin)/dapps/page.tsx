import { asc } from "drizzle-orm";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { getDatabase } from "@/lib/core/database";
import { requireAdminSession } from "@/lib/require-admin-session";
import { trustedDapps } from "@loyal-labs/db-core/schema";

import { DappList } from "./dapp-list";

export const dynamic = "force-dynamic";

export default async function DappsPage() {
  await requireAdminSession();

  const db = getDatabase();
  const rows = await db
    .select()
    .from(trustedDapps)
    .orderBy(asc(trustedDapps.displayOrder), asc(trustedDapps.name));

  const serializedRows = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return (
    <PageContainer>
      <SectionHeader title="dApps" breadcrumbs={[{ label: "dApps" }]} />
      <DappList dapps={serializedRows} />
    </PageContainer>
  );
}
