import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CallbackQueryContext, Context } from "grammy";

mock.module("server-only", () => ({}));

type InsertedVoteValues = {
  action: "LIKE" | "DISLIKE";
  summaryId: string;
  userId: string;
};

const SUMMARY_ID = "123e4567-e89b-12d3-a456-426614174000";
const GROUP_CHAT_ID = "-1001234567890";

let currentVoteTotals = { dislikes: 0, likes: 0 };
let insertBehavior: "duplicate" | "inserted" = "inserted";
let insertCalls: InsertedVoteValues[] = [];
let getOrCreateUserCalls = 0;
let trackCalls: Array<{
  eventName: string;
  properties: Record<string, unknown>;
}> = [];

mock.module("@/lib/core/database", () => ({
  getDatabase: () => ({
    insert: () => ({
      values: (values: InsertedVoteValues) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            insertCalls.push(values);
            return insertBehavior === "duplicate" ? [] : [{ id: "vote-1" }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            groupBy: async () => [currentVoteTotals],
          }),
        }),
      }),
    }),
  }),
}));

mock.module("@/lib/telegram/user-service", () => ({
  getOrCreateUser: async () => {
    getOrCreateUserCalls += 1;
    return "user-1";
  },
}));

mock.module("../analytics", () => ({
  __resetBotAnalyticsStateForTests: () => {},
  createBotTrackingProperties: (input: {
    chatId?: bigint | number | string | null;
    chatType?: string | null;
    userId?: bigint | number | string | null;
  }) => ({
    distinct_id:
      input.userId === null || input.userId === undefined
        ? "tg:unknown"
        : `tg:${input.userId.toString()}`,
    telegram_chat_id: input.chatId?.toString() ?? null,
    telegram_chat_type: input.chatType ?? null,
    telegram_user_id: input.userId?.toString() ?? null,
  }),
  trackBotEvent: (eventName: string, properties: Record<string, unknown>) => {
    trackCalls.push({ eventName, properties });
  },
}));

let buildSummaryVoteKeyboard: typeof import("../summary-votes").buildSummaryVoteKeyboard;
let encodeSummaryVoteCallbackData: typeof import("../summary-votes").encodeSummaryVoteCallbackData;
let handleSummaryVoteCallback: typeof import("../summary-votes").handleSummaryVoteCallback;
let parseSummaryVoteCallbackData: typeof import("../summary-votes").parseSummaryVoteCallbackData;

beforeAll(async () => {
  const loadedModule = await import("../summary-votes");
  buildSummaryVoteKeyboard = loadedModule.buildSummaryVoteKeyboard;
  encodeSummaryVoteCallbackData = loadedModule.encodeSummaryVoteCallbackData;
  handleSummaryVoteCallback = loadedModule.handleSummaryVoteCallback;
  parseSummaryVoteCallbackData = loadedModule.parseSummaryVoteCallbackData;
});

beforeEach(() => {
  currentVoteTotals = { dislikes: 0, likes: 0 };
  insertBehavior = "inserted";
  insertCalls = [];
  getOrCreateUserCalls = 0;
  trackCalls = [];
});

describe("summary vote callback contract", () => {
  test("round-trips valid callback data and rejects malformed data", () => {
    const data = encodeSummaryVoteCallbackData({
      action: "u",
      groupChatId: GROUP_CHAT_ID,
      summaryId: SUMMARY_ID,
    });

    expect(parseSummaryVoteCallbackData(data)).toEqual({
      action: "u",
      groupChatId: GROUP_CHAT_ID,
      summaryId: SUMMARY_ID,
    });
    expect(parseSummaryVoteCallbackData("sv:u:bad-id")).toBeNull();
    expect(parseSummaryVoteCallbackData(`sv:u:${SUMMARY_ID}`)).toBeNull();
  });

  test("keyboard exposes vote, score, and open actions without pinning labels", () => {
    const rows = buildSummaryVoteKeyboard(
      BigInt(GROUP_CHAT_ID),
      SUMMARY_ID,
      5,
      2
    ).inline_keyboard;

    expect(rows).toHaveLength(2);
    expect(rows[0]?.map((button) => button.callback_data)).toEqual([
      `sv:u:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
      `sv:s:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
      `sv:d:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
    ]);
    expect(rows[1]?.[0]?.url).toContain(SUMMARY_ID);
  });
});

describe("handleSummaryVoteCallback", () => {
  test("persists a first vote and refreshes the callback keyboard", async () => {
    currentVoteTotals = { dislikes: 1, likes: 2 };
    const answerCalls: unknown[] = [];
    const editCalls: unknown[] = [];

    await handleSummaryVoteCallback({
      answerCallbackQuery: async (payload?: unknown) => {
        answerCalls.push(payload);
      },
      api: {
        editMessageReplyMarkup: async (...args: unknown[]) => {
          editCalls.push(args);
        },
      },
      callbackQuery: {
        data: `sv:u:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
        message: {
          chat: { id: -1001234 },
          message_id: 99,
        },
      },
      from: { first_name: "Test", id: 123 },
    } as unknown as CallbackQueryContext<Context>);

    expect(insertCalls).toEqual([
      { action: "LIKE", summaryId: SUMMARY_ID, userId: "user-1" },
    ]);
    expect(getOrCreateUserCalls).toBe(1);
    expect(editCalls).toHaveLength(1);
    expect(answerCalls).toEqual([undefined]);
    expect(trackCalls[0]?.eventName).toBe("Bot Summary Like");
  });

  test("does not update the keyboard when the vote already exists", async () => {
    insertBehavior = "duplicate";
    const answerCalls: unknown[] = [];
    const editCalls: unknown[] = [];

    await handleSummaryVoteCallback({
      answerCallbackQuery: async (payload?: unknown) => {
        answerCalls.push(payload);
      },
      api: {
        editMessageReplyMarkup: async (...args: unknown[]) => {
          editCalls.push(args);
        },
      },
      callbackQuery: {
        data: `sv:d:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
        message: {
          chat: { id: -1001234 },
          message_id: 99,
        },
      },
      from: { first_name: "Test", id: 123 },
    } as unknown as CallbackQueryContext<Context>);

    expect(insertCalls).toHaveLength(1);
    expect(editCalls).toHaveLength(0);
    expect(answerCalls[0]).toMatchObject({ show_alert: true });
    expect(trackCalls).toHaveLength(0);
  });

  test("acknowledges stale keyboard edits after persisting the vote", async () => {
    const answerCalls: unknown[] = [];

    await handleSummaryVoteCallback({
      answerCallbackQuery: async (payload?: unknown) => {
        answerCalls.push(payload);
      },
      api: {
        editMessageReplyMarkup: async () => {
          throw { description: "Bad Request: message is not modified" };
        },
      },
      callbackQuery: {
        data: `sv:u:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
        message: {
          chat: { id: -1001234 },
          message_id: 99,
        },
      },
      from: { first_name: "Test", id: 123 },
    } as unknown as CallbackQueryContext<Context>);

    expect(insertCalls).toHaveLength(1);
    expect(answerCalls).toEqual([undefined]);
  });
});
