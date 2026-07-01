import {
  communities,
  summaries,
  type Summary,
} from "@loyal-labs/db-core/schema";
import { and, desc, eq } from "drizzle-orm";
import type { Context, InlineQueryContext } from "grammy";
import {
  type InlineQueryResult,
  type InlineQueryResultArticle,
} from "grammy/types";

import { getDatabase } from "@/lib/core/database";
import { buildSummaryMessagePayload } from "@/lib/telegram/bot-api/summaries";
import { MINI_APP_LINK } from "@/lib/telegram/constants";

const SUMMARY_INLINE_QUERY_RESULTS_LIMIT = 5;

export const SUMMARY_INLINE_QUERY_REGEX = /^summary:\s*(-?\d+)\s*$/;

export const handleInlineQuery = async (ctx: InlineQueryContext<Context>) => {
  await answerInlineQueryWithWalletButton(ctx, []);
};

export const handleSummaryInlineQuery = async (
  ctx: InlineQueryContext<Context>
) => {
  const communityChatId = parseCommunityChatId(ctx.match);
  if (communityChatId === null) {
    await answerInlineQueryWithWalletButton(ctx, []);
    return;
  }

  const db = getDatabase();
  const community = await db.query.communities.findFirst({
    where: and(
      eq(communities.chatId, communityChatId),
      eq(communities.isActive, true)
    ),
  });

  if (!community) {
    await answerInlineQueryWithWalletButton(ctx, []);
    return;
  }

  const latestSummaries = await db.query.summaries.findMany({
    where: eq(summaries.communityId, community.id),
    orderBy: [desc(summaries.createdAt)],
    limit: SUMMARY_INLINE_QUERY_RESULTS_LIMIT,
  });

  if (latestSummaries.length === 0) {
    await answerInlineQueryWithWalletButton(ctx, []);
    return;
  }

  const results = await Promise.all(
    latestSummaries.map((summary) =>
      toInlineSummaryResult(summary, community.chatId, community.chatTitle)
    )
  );

  await answerInlineQueryWithWalletButton(ctx, results);
};

async function answerInlineQueryWithWalletButton(
  ctx: InlineQueryContext<Context>,
  results: InlineQueryResult[]
) {
  await ctx.answerInlineQuery(results, {
    button: {
      text: "Loyal Wallet",
      web_app: {
        url: MINI_APP_LINK,
      },
    },
  });
}

function parseCommunityChatId(match: unknown): bigint | null {
  const capturedValue =
    Array.isArray(match) && typeof match[1] === "string" ? match[1] : null;

  if (!capturedValue) {
    return null;
  }

  try {
    return BigInt(capturedValue);
  } catch {
    return null;
  }
}

async function toInlineSummaryResult(
  summary: Pick<Summary, "createdAt" | "id" | "oneliner" | "topics">,
  sourceCommunityChatId: bigint,
  sourceCommunityTitle: string
): Promise<InlineQueryResultArticle> {
  const messagePayload = await buildSummaryMessagePayload(
    summary,
    sourceCommunityChatId
  );

  return {
    description: summary.oneliner,
    id: summary.id,
    input_message_content: {
      link_preview_options: messagePayload.messageOptions.link_preview_options,
      message_text: messagePayload.messageText,
      parse_mode: messagePayload.messageOptions.parse_mode,
    },
    reply_markup: messagePayload.messageOptions.reply_markup,
    title: `${sourceCommunityTitle} • ${formatSummaryDate(summary.createdAt)}`,
    type: "article",
  };
}

function formatSummaryDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
