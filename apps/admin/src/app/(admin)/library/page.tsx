import { libraryArticles, librarySections } from "@loyal-labs/db-core/schema";
import { asc } from "drizzle-orm";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { getDatabase } from "@/lib/core/database";
import { requireAdminSession } from "@/lib/require-admin-session";

import { LibraryList } from "./library-list";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  await requireAdminSession();

  const db = getDatabase();

  const [sectionRows, articleRows] = await Promise.all([
    db
      .select()
      .from(librarySections)
      .orderBy(asc(librarySections.displayOrder), asc(librarySections.title)),
    db
      .select()
      .from(libraryArticles)
      .orderBy(asc(libraryArticles.displayOrder), asc(libraryArticles.title)),
  ]);

  const sections = sectionRows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const articles = articleRows.map((row) => ({
    ...row,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return (
    <PageContainer>
      <SectionHeader title="Library" breadcrumbs={[{ label: "Library" }]} />
      <LibraryList sections={sections} articles={articles} />
    </PageContainer>
  );
}
