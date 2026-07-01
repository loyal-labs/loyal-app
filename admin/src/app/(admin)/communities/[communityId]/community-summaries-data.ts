import "server-only";

import { unstable_cache } from "next/cache";
import { count, desc, eq, inArray } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { DATA_CACHE_TTL_SECONDS, communityTag } from "@/lib/data-cache";
import { summaries, summaryVotes } from "@loyal-labs/db-core/schema";

export const SUMMARY_PAGE_SIZE = 10;

export type SummaryTopic = {
  title: string;
  content: string;
  sources: string[];
};

export type CommunitySummaryRow = {
  id: string;
  createdAt: string;
  oneliner: string;
  topics: SummaryTopic[];
  likesCount: number;
  dislikesCount: number;
};

export type CommunitySummariesPageData = {
  rows: CommunitySummaryRow[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export function parsePageParam(value: string | undefined): number {
  if (!value) return 1;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function normalizeTopic(value: unknown): SummaryTopic | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    title?: unknown;
    content?: unknown;
    sources?: unknown;
  };

  if (
    typeof candidate.title !== "string" ||
    typeof candidate.content !== "string"
  ) {
    return null;
  }

  const normalizedSources = Array.isArray(candidate.sources)
    ? candidate.sources
        .filter((source): source is string => typeof source === "string")
        .map((source) => source.trim())
        .filter((source) => source.length > 0)
    : [];

  return {
    title: candidate.title,
    content: candidate.content,
    sources: normalizedSources,
  };
}

function normalizeTopics(value: unknown): SummaryTopic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((topic) => normalizeTopic(topic))
    .filter((topic): topic is SummaryTopic => topic !== null);
}

async function loadCommunitySummariesPage(
  communityId: string,
  requestedPage: number
): Promise<CommunitySummariesPageData> {
  const db = getDatabase();
  const [totals] = await db
    .select({
      count: count(),
    })
    .from(summaries)
    .where(eq(summaries.communityId, communityId));

  const totalCount = Number(totals?.count) || 0;
  const totalPages =
    totalCount > 0 ? Math.ceil(totalCount / SUMMARY_PAGE_SIZE) : 1;
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const offset = (currentPage - 1) * SUMMARY_PAGE_SIZE;

  const rows = await db
    .select({
      id: summaries.id,
      createdAt: summaries.createdAt,
      oneliner: summaries.oneliner,
      topics: summaries.topics,
    })
    .from(summaries)
    .where(eq(summaries.communityId, communityId))
    .orderBy(desc(summaries.createdAt), desc(summaries.id))
    .limit(SUMMARY_PAGE_SIZE)
    .offset(offset);

  if (rows.length === 0) {
    return {
      rows: [],
      totalCount,
      currentPage,
      totalPages,
      hasPreviousPage: currentPage > 1,
      hasNextPage: currentPage < totalPages,
    };
  }

  const summaryIds = rows.map((row) => row.id);
  const voteRows = await db
    .select({
      summaryId: summaryVotes.summaryId,
      action: summaryVotes.action,
      count: count(),
    })
    .from(summaryVotes)
    .where(inArray(summaryVotes.summaryId, summaryIds))
    .groupBy(summaryVotes.summaryId, summaryVotes.action);

  const voteCountsBySummaryId = new Map<
    string,
    { likesCount: number; dislikesCount: number }
  >();
  voteRows.forEach((row) => {
    const current = voteCountsBySummaryId.get(row.summaryId) ?? {
      likesCount: 0,
      dislikesCount: 0,
    };
    const action = row.action?.toUpperCase();
    const rowCount = Number(row.count) || 0;

    if (action === "LIKE") {
      current.likesCount += rowCount;
    } else if (action === "DISLIKE") {
      current.dislikesCount += rowCount;
    }

    voteCountsBySummaryId.set(row.summaryId, current);
  });

  const normalizedRows: CommunitySummaryRow[] = rows.map((row) => ({
    ...(voteCountsBySummaryId.get(row.id) ?? {
      likesCount: 0,
      dislikesCount: 0,
    }),
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    oneliner: row.oneliner,
    topics: normalizeTopics(row.topics),
  }));

  return {
    rows: normalizedRows,
    totalCount,
    currentPage,
    totalPages,
    hasPreviousPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
  };
}

export async function getCommunitySummariesPage(
  communityId: string,
  requestedPage: number
): Promise<CommunitySummariesPageData> {
  const getCachedCommunitySummariesPage = unstable_cache(
    async () => loadCommunitySummariesPage(communityId, requestedPage),
    ["community-summaries-page", communityId, String(requestedPage)],
    {
      revalidate: DATA_CACHE_TTL_SECONDS,
      tags: [communityTag(communityId)],
    }
  );

  return getCachedCommunitySummariesPage();
}
