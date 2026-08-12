import { desc } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { admins } from "@loyal-labs/db-core/schema";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { AdminList } from "./admin-list";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(admins)
    .orderBy(desc(admins.addedAt));

  const serializedRows = rows.map((row) => ({
    ...row,
    telegramId: row.telegramId.toString(),
    addedAt: row.addedAt.toISOString(),
  }));

  return (
    <PageContainer>
      <SectionHeader title="Admins" breadcrumbs={[{ label: "Admins" }]} />
      <AdminList admins={serializedRows} />
    </PageContainer>
  );
}
