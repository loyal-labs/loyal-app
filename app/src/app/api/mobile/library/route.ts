import { libraryArticles, librarySections } from "@loyal-labs/db-core/schema";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/core/database";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
};

export type MobileLibraryArticle = {
  id: string;
  sectionId: string;
  title: string;
  coverImageUrl: string;
  contentMarkdown: string;
  readTime: string;
  excerpt: string | null;
  isFeatured: boolean;
  displayOrder: number;
  publishedAt: string | null;
};

export type MobileLibrarySection = {
  id: string;
  title: string;
  displayOrder: number;
  articles: MobileLibraryArticle[];
};

export type MobileLibraryResponse = {
  featured: MobileLibraryArticle[];
  sections: MobileLibrarySection[];
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDatabase();

    const [sectionRows, articleRows] = await Promise.all([
      db
        .select({
          id: librarySections.id,
          title: librarySections.title,
          displayOrder: librarySections.displayOrder,
        })
        .from(librarySections)
        .where(eq(librarySections.isActive, true))
        .orderBy(asc(librarySections.displayOrder), asc(librarySections.title)),
      db
        .select({
          id: libraryArticles.id,
          sectionId: libraryArticles.sectionId,
          title: libraryArticles.title,
          coverImageUrl: libraryArticles.coverImageUrl,
          contentMarkdown: libraryArticles.contentMarkdown,
          readTime: libraryArticles.readTime,
          excerpt: libraryArticles.excerpt,
          isFeatured: libraryArticles.isFeatured,
          displayOrder: libraryArticles.displayOrder,
          publishedAt: libraryArticles.publishedAt,
        })
        .from(libraryArticles)
        .where(eq(libraryArticles.isActive, true))
        .orderBy(
          asc(libraryArticles.displayOrder),
          asc(libraryArticles.title)
        ),
    ]);

    const activeSectionIds = new Set(sectionRows.map((row) => row.id));
    const articlesByActiveSection = new Map<string, MobileLibraryArticle[]>();
    const featured: MobileLibraryArticle[] = [];

    for (const row of articleRows) {
      const article: MobileLibraryArticle = {
        id: row.id,
        sectionId: row.sectionId,
        title: row.title,
        coverImageUrl: row.coverImageUrl,
        contentMarkdown: row.contentMarkdown,
        readTime: row.readTime,
        excerpt: row.excerpt,
        isFeatured: row.isFeatured,
        displayOrder: row.displayOrder,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      };

      if (row.isFeatured) {
        featured.push(article);
      }

      if (!activeSectionIds.has(row.sectionId)) continue;

      const list = articlesByActiveSection.get(row.sectionId);
      if (list) {
        list.push(article);
      } else {
        articlesByActiveSection.set(row.sectionId, [article]);
      }
    }

    const sections: MobileLibrarySection[] = sectionRows.map((row) => ({
      id: row.id,
      title: row.title,
      displayOrder: row.displayOrder,
      articles: articlesByActiveSection.get(row.id) ?? [],
    }));

    const body: MobileLibraryResponse = { featured, sections };
    return NextResponse.json(body, { headers: corsHeaders });
  } catch (error) {
    console.error("[api/mobile/library] Failed to fetch library", error);
    return NextResponse.json(
      { error: "Failed to fetch library" },
      { headers: corsHeaders, status: 500 }
    );
  }
}
