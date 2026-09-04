import {
  communities,
  messages,
  summaries,
  type Summary,
  type Topic,
} from "@loyal-labs/db-core/schema";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { type Bot } from "grammy";

import { getDatabase } from "@/lib/core/database";
import {
  getSummaryGenerationService,
  type SummaryGenerationService,
} from "@/lib/telegram/bot-api/summary-generation";

import { buildSummaryMessageWithPreview } from "./build-summary-og-url";
import {
  buildSummaryVoteKeyboard,
  getSummaryVoteTotals,
} from "./summary-votes";
import type {
  SendLatestSummaryOptions,
  SendSummaryResult,
  SummaryDeliveredMessage,
} from "./types";

export const MIN_MESSAGES_FOR_SUMMARY = 3;
export const DAILY_SUMMARY_TRIGGER_TYPE = "daily";
const MAX_SUMMARY_INPUT_CHARS = 12_000;
const MAX_SUMMARY_BULLET_COUNT = 5;
const MAX_SUMMARY_BULLET_CONTENT_CHARS = 450;
const MAX_SUMMARY_OG_TEXT_CHARS = 110;
const SUMMARY_BULLET_FALLBACK_CONTENT = "No detailed points available today.";
const SUMMARY_BULLET_CUSTOM_EMOJI_ID = "5255883309841422076";
const SUMMARY_BULLET_TAG = `<tg-emoji emoji-id="${SUMMARY_BULLET_CUSTOM_EMOJI_ID}">🔹</tg-emoji>`;

type SummaryWithCommunity = Summary & {
  community: {
    chatId: bigint;
    isActive: boolean;
    summaryNotificationsEnabled: boolean;
  };
};

export type SummaryRunContext = {
  dayEndUtc: Date;
  dayStartUtc: Date;
  windowEnd: Date;
  windowStart: Date;
};

export type GenerateOrGetSummaryForRunResult =
  | { status: "created"; summaryId: string; messageCount: number }
  | { status: "existing"; summaryId: string; messageCount: number }
  | { status: "not_enough_messages"; messageCount: number };

export type CreateSummariesServiceDeps = {
  db?: ReturnType<typeof getDatabase>;
  logger?: Pick<typeof console, "log">;
  summaryGenerationService?: SummaryGenerationService;
  summaryModelResolver?: () => string | undefined;
};

export type SummaryMessagePayload = {
  messageOptions: {
    parse_mode: "HTML";
    link_preview_options: { prefer_large_media: boolean };
    reply_markup: ReturnType<typeof buildSummaryVoteKeyboard>;
  };
  messageText: string;
};

export function createSummariesService(deps?: CreateSummariesServiceDeps) {
  const providedDb = deps?.db;
  const logger = deps?.logger ?? console;
  let summaryGenerationService = deps?.summaryGenerationService;
  const summaryModelResolver = deps?.summaryModelResolver ?? (() => undefined);

  async function generateOrGetSummaryForRun(input: {
    chatTitle: string;
    communityId: string;
    run: SummaryRunContext;
  }): Promise<GenerateOrGetSummaryForRunResult> {
    const triggerKey = buildDailySummaryTriggerKey(input.run.dayStartUtc);
    const messageCount = await countMessagesInWindow(
      input.communityId,
      input.run
    );

    if (messageCount < MIN_MESSAGES_FOR_SUMMARY) {
      return { status: "not_enough_messages", messageCount };
    }

    const existingSummary = await findExistingSummaryForRun(
      input.communityId,
      triggerKey,
      input.run.dayStartUtc,
      input.run.dayEndUtc
    );
    if (existingSummary) {
      return {
        status: "existing",
        summaryId: existingSummary.id,
        messageCount: existingSummary.messageCount,
      };
    }

    const recentMessages = await getDb().query.messages.findMany({
      where: and(
        eq(messages.communityId, input.communityId),
        gte(messages.createdAt, input.run.windowStart),
        lte(messages.createdAt, input.run.windowEnd)
      ),
      with: { user: true },
      orderBy: [asc(messages.telegramMessageId)],
    });

    if (recentMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
      return {
        status: "not_enough_messages",
        messageCount: recentMessages.length,
      };
    }

    const formattedMessages = buildSummaryInput(recentMessages);
    if (!formattedMessages) {
      return {
        status: "not_enough_messages",
        messageCount: recentMessages.length,
      };
    }

    const generatedSummary =
      await getOrCreateSummaryGenerationService().generate({
        chatTitle: input.chatTitle,
        dayKeyUtc: toUtcDayKey(input.run.dayStartUtc),
        modelKey: summaryModelResolver(),
        participants: recentMessages.map((message) => message.user.displayName),
        transcript: formattedMessages,
      });

    const insertedSummary = await getDb()
      .insert(summaries)
      .values({
        communityId: input.communityId,
        chatTitle: input.chatTitle,
        fromMessageId: recentMessages[0].telegramMessageId,
        messageCount,
        oneliner: generatedSummary.oneliner,
        toMessageId:
          recentMessages[recentMessages.length - 1].telegramMessageId,
        topics: generatedSummary.topics as Topic[],
        triggerKey,
        triggerType: DAILY_SUMMARY_TRIGGER_TYPE,
      })
      .onConflictDoNothing()
      .returning({ id: summaries.id, messageCount: summaries.messageCount });

    if (insertedSummary.length > 0) {
      return {
        status: "created",
        summaryId: insertedSummary[0].id,
        messageCount: insertedSummary[0].messageCount,
      };
    }

    const conflictedSummary = await findSummaryByTriggerKey(
      input.communityId,
      triggerKey
    );
    if (!conflictedSummary) {
      throw new Error("Failed to create summary");
    }

    return {
      status: "existing",
      summaryId: conflictedSummary.id,
      messageCount: conflictedSummary.messageCount,
    };
  }

  async function sendLatestSummary(
    bot: Bot,
    sourceChatId: bigint,
    options?: SendLatestSummaryOptions
  ): Promise<SendSummaryResult> {
    const destinationChatId = options?.destinationChatId ?? sourceChatId;
    const replyToMessageId = options?.replyToMessageId;

    const community = await getDb().query.communities.findFirst({
      where: and(
        eq(communities.chatId, sourceChatId),
        eq(communities.isActive, true)
      ),
    });

    if (!community) {
      return { sent: false, reason: "not_activated" };
    }

    if (!community.summaryNotificationsEnabled) {
      return { sent: false, reason: "notifications_disabled" };
    }

    const latestSummary = await getDb().query.summaries.findFirst({
      where: eq(summaries.communityId, community.id),
      orderBy: [desc(summaries.createdAt)],
    });

    if (!latestSummary) {
      return { sent: false, reason: "no_summaries" };
    }

    const deliveredMessage = await sendSummaryToChat(
      bot,
      {
        createdAt: latestSummary.createdAt,
        id: latestSummary.id,
        oneliner: latestSummary.oneliner,
        topics: latestSummary.topics,
      },
      {
        destinationChatId,
        replyToMessageId,
        sourceCommunityChatId: sourceChatId,
      }
    );

    return { deliveredMessage, sent: true };
  }

  async function sendSummaryById(
    bot: Bot,
    summaryId: string,
    options?: SendLatestSummaryOptions
  ): Promise<SendSummaryResult> {
    const summary = await getSummaryWithCommunity(summaryId);
    if (!summary) {
      return { sent: false, reason: "no_summaries" };
    }

    if (!summary.community.isActive) {
      return { sent: false, reason: "not_activated" };
    }

    if (!summary.community.summaryNotificationsEnabled) {
      return { sent: false, reason: "notifications_disabled" };
    }

    const deliveredMessage = await sendSummaryToChat(
      bot,
      {
        createdAt: summary.createdAt,
        id: summary.id,
        oneliner: summary.oneliner,
        topics: summary.topics,
      },
      {
        destinationChatId:
          options?.destinationChatId ?? summary.community.chatId,
        replyToMessageId: options?.replyToMessageId,
        sourceCommunityChatId: summary.community.chatId,
      }
    );

    return { deliveredMessage, sent: true };
  }

  async function countMessagesInWindow(
    communityId: string,
    run: SummaryRunContext
  ): Promise<number> {
    const [result] = await getDb()
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.communityId, communityId),
          gte(messages.createdAt, run.windowStart),
          lte(messages.createdAt, run.windowEnd)
        )
      );

    return Number(result?.count ?? 0);
  }

  async function findSummaryByTriggerKey(
    communityId: string,
    triggerKey: string
  ): Promise<Summary | null> {
    return (
      (await getDb().query.summaries.findFirst({
        where: and(
          eq(summaries.communityId, communityId),
          eq(summaries.triggerKey, triggerKey)
        ),
        orderBy: [desc(summaries.createdAt)],
      })) ?? null
    );
  }

  async function findExistingSummaryForRun(
    communityId: string,
    triggerKey: string,
    dayStartUtc: Date,
    dayEndUtc: Date
  ): Promise<Summary | null> {
    const byTriggerKey = await findSummaryByTriggerKey(communityId, triggerKey);
    if (byTriggerKey) {
      return byTriggerKey;
    }

    return (
      (await getDb().query.summaries.findFirst({
        where: and(
          eq(summaries.communityId, communityId),
          gte(summaries.createdAt, dayStartUtc),
          lte(summaries.createdAt, dayEndUtc)
        ),
        orderBy: [desc(summaries.createdAt)],
      })) ?? null
    );
  }

  async function getSummaryWithCommunity(
    summaryId: string
  ): Promise<SummaryWithCommunity | null> {
    return (
      (await getDb().query.summaries.findFirst({
        where: eq(summaries.id, summaryId),
        with: {
          community: {
            columns: {
              chatId: true,
              isActive: true,
              summaryNotificationsEnabled: true,
            },
          },
        },
      })) ?? null
    );
  }

  async function sendSummaryToChat(
    bot: Bot,
    summary: Pick<Summary, "createdAt" | "id" | "oneliner" | "topics">,
    options: {
      destinationChatId: bigint;
      sourceCommunityChatId: bigint;
      replyToMessageId?: number;
    }
  ): Promise<SummaryDeliveredMessage> {
    const messagePayload = await buildSummaryMessagePayload(
      summary,
      options.sourceCommunityChatId
    );

    const sentMessage = await sendSummaryMessage(bot, {
      destinationChatId: options.destinationChatId,
      messageOptions: messagePayload.messageOptions,
      messageText: messagePayload.messageText,
      replyToMessageId: options.replyToMessageId,
    });

    return {
      destinationChatId: options.destinationChatId,
      messageId: sentMessage.message_id,
      sourceCommunityChatId: options.sourceCommunityChatId,
    };
  }

  async function sendSummaryMessage(
    bot: Bot,
    params: {
      destinationChatId: bigint;
      messageOptions: {
        parse_mode: "HTML";
        link_preview_options: { prefer_large_media: boolean };
        reply_markup: ReturnType<typeof buildSummaryVoteKeyboard>;
      };
      messageText: string;
      replyToMessageId?: number;
    }
  ) {
    if (params.replyToMessageId) {
      try {
        return await bot.api.sendMessage(
          Number(params.destinationChatId),
          params.messageText,
          {
            ...params.messageOptions,
            reply_parameters: { message_id: params.replyToMessageId },
          }
        );
      } catch (error) {
        logger.log(
          "Failed to send summary as reply, sending without reply",
          error
        );
      }
    }

    return bot.api.sendMessage(
      Number(params.destinationChatId),
      params.messageText,
      params.messageOptions
    );
  }

  function getOrCreateSummaryGenerationService(): SummaryGenerationService {
    if (summaryGenerationService) {
      return summaryGenerationService;
    }

    summaryGenerationService = getSummaryGenerationService();
    return summaryGenerationService;
  }

  function getDb(): ReturnType<typeof getDatabase> {
    return providedDb ?? getDatabase();
  }

  return {
    generateOrGetSummaryForRun,
    sendLatestSummary,
    sendSummaryById,
  };
}

const defaultSummariesService = createSummariesService();

export const generateOrGetSummaryForRun =
  defaultSummariesService.generateOrGetSummaryForRun;
export const sendLatestSummary = defaultSummariesService.sendLatestSummary;
export const sendSummaryById = defaultSummariesService.sendSummaryById;

function toUtcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDailySummaryTriggerKey(dayStartUtc: Date): string {
  return `${DAILY_SUMMARY_TRIGGER_TYPE}:${toUtcDayKey(dayStartUtc)}`;
}

function buildSummaryInput(
  recentMessages: Array<{ content: string; user: { displayName: string } }>
): string {
  let output = "";

  for (const message of recentMessages) {
    const line = `${message.user.displayName}: ${message.content}`;
    const nextLength =
      output.length === 0 ? line.length : output.length + 1 + line.length;

    if (nextLength > MAX_SUMMARY_INPUT_CHARS) {
      if (!output) {
        return line.slice(0, MAX_SUMMARY_INPUT_CHARS);
      }
      break;
    }

    output = output.length === 0 ? line : `${output}\n${line}`;
  }

  return output;
}

export async function buildSummaryMessagePayload(
  summary: Pick<Summary, "createdAt" | "id" | "oneliner" | "topics">,
  sourceCommunityChatId: bigint
): Promise<SummaryMessagePayload> {
  const { firstBulletContent, messageBody } = buildSummaryMessageBody(
    summary.topics
  );
  const ogText = buildSummaryOgText(summary.oneliner, firstBulletContent);

  const messageWithPreview = buildSummaryMessageWithPreview(
    messageBody,
    ogText,
    summary.createdAt
  );

  const voteTotals = await getSummaryVoteTotals(summary.id);
  const keyboard = buildSummaryVoteKeyboard(
    sourceCommunityChatId,
    summary.id,
    voteTotals.likes,
    voteTotals.dislikes
  );

  return {
    messageOptions: {
      parse_mode: "HTML",
      link_preview_options: { prefer_large_media: true },
      reply_markup: keyboard,
    },
    messageText: messageWithPreview,
  };
}
function buildSummaryMessageBody(topics: Topic[]): {
  firstBulletContent: string;
  messageBody: string;
} {
  const normalizedBullets = topics
    .slice(0, MAX_SUMMARY_BULLET_COUNT)
    .map((topic) => {
      const firstSentence = extractFirstSentence(topic.content);
      if (firstSentence.length === 0) {
        return null;
      }

      return {
        content: truncateForBullet(firstSentence),
      };
    })
    .filter((bullet): bullet is { content: string } => Boolean(bullet));

  if (normalizedBullets.length === 0) {
    return {
      firstBulletContent: SUMMARY_BULLET_FALLBACK_CONTENT,
      messageBody: `${SUMMARY_BULLET_TAG} ${escapeTelegramHtml(
        SUMMARY_BULLET_FALLBACK_CONTENT
      )}`,
    };
  }

  const bulletLines = normalizedBullets.map(
    (bullet) => `${SUMMARY_BULLET_TAG} ${escapeTelegramHtml(bullet.content)}`
  );

  return {
    firstBulletContent: normalizedBullets[0].content,
    messageBody: bulletLines.join("\n\n"),
  };
}

function buildSummaryOgText(
  oneliner: string,
  firstBulletContent: string
): string {
  const normalizedOneliner = normalizeWhitespace(oneliner);
  if (normalizedOneliner.length > 0) {
    return normalizedOneliner.slice(0, MAX_SUMMARY_OG_TEXT_CHARS);
  }

  return firstBulletContent.slice(0, MAX_SUMMARY_OG_TEXT_CHARS);
}

function truncateForBullet(content: string): string {
  if (content.length <= MAX_SUMMARY_BULLET_CONTENT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_SUMMARY_BULLET_CONTENT_CHARS - 1).trimEnd()}…`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractFirstSentence(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : normalized;
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
