import {
  communities,
  summaries,
  type Summary,
} from "@loyal-labs/db-core/schema";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/core/database";

type CommunityPhotoSettings = {
  photoUrl?: string;
  // Deprecated compatibility fields; kept temporarily for clients still migrating.
  photoBase64?: string;
  photoMimeType?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const groupChatId = searchParams.get("groupChatId");
    const db = getDatabase();

    const result = groupChatId
      ? await fetchSummariesByGroupChatId(db, groupChatId)
      : (
          await db
            .select({
              summary: summaries,
              community: communities,
            })
            .from(summaries)
            .innerJoin(communities, eq(summaries.communityId, communities.id))
            .where(eq(communities.isPublic, true))
            .orderBy(desc(summaries.createdAt))
        ).map(({ summary, community }) => ({ ...summary, community }));

    const transformedSummaries = result.map((item) => {
      const settings = item.community.settings as CommunityPhotoSettings | null;
      return {
        id: item.id,
        chatId: String(item.community.chatId),
        title: item.chatTitle,
        messageCount: item.messageCount,
        oneliner: item.oneliner,
        photoUrl: settings?.photoUrl,
        // Deprecated compatibility fields; remove after migration window.
        photoBase64: settings?.photoBase64,
        photoMimeType: settings?.photoMimeType,
        topics: item.topics.map((topic, index) => ({
          id: `${item.id}-${index}`,
          title: topic.title,
          content: topic.content,
          sources: topic.sources,
        })),
        createdAt: item.createdAt.toISOString(),
      };
    });

    return NextResponse.json(
      { summaries: transformedSummaries },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[api/summaries] Failed to fetch summaries:", error);
    return NextResponse.json(
      { error: "Failed to fetch summaries" },
      { status: 500, headers: corsHeaders }
    );
  }
}

type SummaryWithCommunity = Summary & {
  community: { chatId: bigint; settings: unknown };
};

async function fetchSummariesByGroupChatId(
  db: ReturnType<typeof getDatabase>,
  groupChatId: string
): Promise<SummaryWithCommunity[]> {
  const community = await db.query.communities.findFirst({
    where: and(
      eq(communities.chatId, BigInt(groupChatId)),
      eq(communities.isPublic, true)
    ),
  });

  if (!community) return [];

  const summaryResults = await db.query.summaries.findMany({
    where: eq(summaries.communityId, community.id),
    orderBy: [desc(summaries.createdAt)],
  });

  return summaryResults.map((s) => ({ ...s, community }));
}
