import {
  summaries,
  type SummaryVoteAction as PersistedSummaryVoteAction,
  summaryVotes,
} from "@loyal-labs/db-core/schema";
import { eq, sql } from "drizzle-orm";
import type { CallbackQueryContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";

import { getDatabase } from "@/lib/core/database";
import { buildSummaryFeedMiniAppUrl } from "@/lib/telegram/mini-app/start-param";
import { getOrCreateUser } from "@/lib/telegram/user-service";
import { getTelegramDisplayName } from "@/lib/telegram/utils";

import { trackBotEvent } from "./analytics";
import { isMessageNotModifiedError } from "./callback-query-utils";

type SummaryVoteAction = "u" | "d" | "s";
type MixpanelTrackProperties = Record<string, boolean | null | number | string>;

type SummaryVoteCallbackData = {
  action: SummaryVoteAction;
  groupChatId: string;
  summaryId: string;
};

export type SummaryVoteTotals = {
  dislikes: number;
  likes: number;
  score: number;
};

const SUMMARY_ID_REGEX_PART =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const GROUP_CHAT_ID_REGEX_PART = "-?\\d+";
const DUPLICATE_VOTE_ALERT_CACHE_TIME_SECONDS = 300;
const BOT_SUMMARY_LIKE_EVENT = "Bot Summary Like";
const BOT_SUMMARY_DISLIKE_EVENT = "Bot Summary Dislike";
const SUMMARY_VOTE_LIKE_CUSTOM_EMOJI_ID = "5447485069386090205";
const SUMMARY_VOTE_DISLIKE_CUSTOM_EMOJI_ID = "5445146433923616423";
const SUMMARY_OPEN_BUTTON_CUSTOM_EMOJI_ID = "5235480870860660944";
const SUMMARY_SCORE_ZERO_CUSTOM_EMOJI_ID = "5447522585925426434";
const SUMMARY_SCORE_NEGATIVE_CUSTOM_EMOJI_ID = "5447484068658714886";
const SUMMARY_SCORE_POSITIVE_CUSTOM_EMOJI_ID = "5445293605272984280";

function getVoteEventName(
  voteAction: PersistedSummaryVoteAction
): string | null {
  if (voteAction === "LIKE") {
    return BOT_SUMMARY_LIKE_EVENT;
  }

  if (voteAction === "DISLIKE") {
    return BOT_SUMMARY_DISLIKE_EVENT;
  }

  return null;
}

function trackSummaryVoteEvent(
  voteAction: PersistedSummaryVoteAction,
  properties: MixpanelTrackProperties
): void {
  const eventName = getVoteEventName(voteAction);
  if (!eventName) {
    return;
  }

  trackBotEvent(eventName, properties);
}

export const SUMMARY_VOTE_CALLBACK_DATA_REGEX = new RegExp(
  `^sv:(u|d|s):(${SUMMARY_ID_REGEX_PART}):(${GROUP_CHAT_ID_REGEX_PART})$`
);

export function encodeSummaryVoteCallbackData(
  callbackData: SummaryVoteCallbackData
): string {
  return `sv:${callbackData.action}:${callbackData.summaryId}:${callbackData.groupChatId}`;
}

export function parseSummaryVoteCallbackData(
  data: string
): SummaryVoteCallbackData | null {
  const matches = SUMMARY_VOTE_CALLBACK_DATA_REGEX.exec(data);
  if (!matches) {
    return null;
  }

  const action = matches[1];
  const summaryId = matches[2];
  const groupChatId = matches[3];

  if (action !== "u" && action !== "d" && action !== "s") {
    return null;
  }

  return {
    action,
    groupChatId,
    summaryId,
  };
}

export function buildSummaryVoteKeyboard(
  groupChatId: bigint,
  summaryId: string,
  likes: number,
  dislikes: number
): InlineKeyboard {
  const score = likes - dislikes;
  const scoreCustomEmojiId = resolveScoreCustomEmojiId(score);

  return new InlineKeyboard()
    .text(
      {
        text: "Like",
        icon_custom_emoji_id: SUMMARY_VOTE_LIKE_CUSTOM_EMOJI_ID,
      },
      encodeSummaryVoteCallbackData({
        action: "u",
        groupChatId: groupChatId.toString(),
        summaryId,
      })
    )
    .text(
      {
        text: `Score: ${score}`,
        icon_custom_emoji_id: scoreCustomEmojiId,
      },
      encodeSummaryVoteCallbackData({
        action: "s",
        groupChatId: groupChatId.toString(),
        summaryId,
      })
    )
    .text(
      {
        text: "Dislike",
        icon_custom_emoji_id: SUMMARY_VOTE_DISLIKE_CUSTOM_EMOJI_ID,
      },
      encodeSummaryVoteCallbackData({
        action: "d",
        groupChatId: groupChatId.toString(),
        summaryId,
      })
    )
    .row()
    .url(
      {
        style: "primary",
        text: "Open",
        icon_custom_emoji_id: SUMMARY_OPEN_BUTTON_CUSTOM_EMOJI_ID,
      },
      buildSummaryFeedMiniAppUrl(groupChatId, summaryId)
    );
}

function resolveScoreCustomEmojiId(score: number): string {
  if (score > 0) {
    return SUMMARY_SCORE_POSITIVE_CUSTOM_EMOJI_ID;
  }

  if (score < 0) {
    return SUMMARY_SCORE_NEGATIVE_CUSTOM_EMOJI_ID;
  }

  return SUMMARY_SCORE_ZERO_CUSTOM_EMOJI_ID;
}

export async function getSummaryVoteTotals(
  summaryId: string
): Promise<SummaryVoteTotals> {
  const db = getDatabase();

  const [result] = await db
    .select({
      dislikes: sql<number>`coalesce(sum(case when ${summaryVotes.action} = 'DISLIKE' then 1 else 0 end), 0)`,
      likes: sql<number>`coalesce(sum(case when ${summaryVotes.action} = 'LIKE' then 1 else 0 end), 0)`,
    })
    .from(summaries)
    .leftJoin(summaryVotes, eq(summaryVotes.summaryId, summaries.id))
    .where(eq(summaries.id, summaryId))
    .groupBy(summaries.id);

  return toSummaryVoteTotals({
    dislikes: Number(result?.dislikes ?? 0),
    likes: Number(result?.likes ?? 0),
  });
}

function toSummaryVoteTotals(input: {
  dislikes: number;
  likes: number;
}): SummaryVoteTotals {
  const likes = Number.isFinite(input.likes) ? input.likes : 0;
  const dislikes = Number.isFinite(input.dislikes) ? input.dislikes : 0;

  return {
    dislikes,
    likes,
    score: likes - dislikes,
  };
}

function mapVoteAction(
  action: SummaryVoteAction
): PersistedSummaryVoteAction | null {
  if (action === "u") {
    return "LIKE";
  }

  if (action === "d") {
    return "DISLIKE";
  }

  return null;
}

export async function handleSummaryVoteCallback(
  ctx: CallbackQueryContext<Context>
): Promise<void> {
  const callbackData = parseSummaryVoteCallbackData(ctx.callbackQuery.data);
  if (!callbackData) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (callbackData.action === "s") {
    try {
      const voteTotals = await getSummaryVoteTotals(callbackData.summaryId);
      await ctx.answerCallbackQuery({
        show_alert: true,
        text: `Current summary score is ${voteTotals.score}.`,
      });
    } catch (error) {
      console.error("Failed to fetch summary score", error);
      await ctx.answerCallbackQuery({
        show_alert: true,
        text: "Unable to load summary score right now.",
      });
    }
    return;
  }

  const callbackMessage = ctx.callbackQuery.message;
  if (!callbackMessage) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (!ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }

  try {
    const voteAction = mapVoteAction(callbackData.action);
    if (!voteAction) {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = await getOrCreateUser(BigInt(ctx.from.id), {
      username: ctx.from.username || null,
      displayName: getTelegramDisplayName(ctx.from),
    });

    const db = getDatabase();
    const insertedVote = await db
      .insert(summaryVotes)
      .values({
        action: voteAction,
        summaryId: callbackData.summaryId,
        userId,
      })
      .onConflictDoNothing()
      .returning({ id: summaryVotes.id });

    if (insertedVote.length === 0) {
      await ctx.answerCallbackQuery({
        cache_time: DUPLICATE_VOTE_ALERT_CACHE_TIME_SECONDS,
        show_alert: true,
        text: "You've voted already!",
      });
      return;
    }

    trackSummaryVoteEvent(voteAction, {
      distinct_id: `tg:${ctx.from.id}`,
      group_chat_id: callbackData.groupChatId,
      summary_id: callbackData.summaryId,
      telegram_chat_id: callbackMessage.chat.id.toString(),
      telegram_chat_type: callbackMessage.chat.type ?? null,
      telegram_user_id: ctx.from.id.toString(),
      vote_action: voteAction,
    });

    const voteTotals = await getSummaryVoteTotals(callbackData.summaryId);

    await ctx.api.editMessageReplyMarkup(
      callbackMessage.chat.id,
      callbackMessage.message_id,
      {
        reply_markup: buildSummaryVoteKeyboard(
          BigInt(callbackData.groupChatId),
          callbackData.summaryId,
          voteTotals.likes,
          voteTotals.dislikes
        ),
      }
    );
    await ctx.answerCallbackQuery();
  } catch (error) {
    if (isMessageNotModifiedError(error)) {
      await ctx.answerCallbackQuery();
      return;
    }

    console.error("Failed to update summary vote keyboard", error);
    await ctx.answerCallbackQuery({
      show_alert: true,
      text: "Unable to update summary score right now.",
    });
  }
}
