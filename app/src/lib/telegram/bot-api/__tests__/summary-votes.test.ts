import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { CallbackQueryContext, Context } from "grammy";

import { buildSummaryFeedMiniAppUrl } from "@/lib/telegram/mini-app/start-param";

mock.module("server-only", () => ({}));

type InsertedVoteValues = {
  action: "LIKE" | "DISLIKE";
  summaryId: string;
  userId: string;
};

const SUMMARY_ID = "123e4567-e89b-12d3-a456-426614174000";
const GROUP_CHAT_ID = "-1001234567890";
const SUMMARY_VOTE_LIKE_CUSTOM_EMOJI_ID = "5447485069386090205";
const SUMMARY_VOTE_DISLIKE_CUSTOM_EMOJI_ID = "5445146433923616423";
const SUMMARY_OPEN_BUTTON_CUSTOM_EMOJI_ID = "5235480870860660944";
const SUMMARY_SCORE_ZERO_CUSTOM_EMOJI_ID = "5447522585925426434";
const SUMMARY_SCORE_NEGATIVE_CUSTOM_EMOJI_ID = "5447484068658714886";
const SUMMARY_SCORE_POSITIVE_CUSTOM_EMOJI_ID = "5445293605272984280";

let currentVoteTotals = { likes: 0, dislikes: 0 };
let insertBehavior: "inserted" | "duplicate" | "throw" = "inserted";
let insertCalls: InsertedVoteValues[] = [];
let getOrCreateUserCalls: unknown[] = [];
let userIdResult = "user-1";
const mixpanelInitTokens: string[] = [];
const mixpanelTrackCalls: Array<{
  eventName: string;
  properties: Record<string, unknown>;
}> = [];
const mixpanelPeopleSetCalls: Array<{
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];
const mixpanelPeopleSetOnceCalls: Array<{
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];
const mixpanelPeopleUnionCalls: Array<{
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];

mock.module("mixpanel", () => ({
  default: {
    init: (token: string) => {
      mixpanelInitTokens.push(token);
      return {
        track: (
          eventName: string,
          properties: Record<string, unknown>,
          callback?: (error?: unknown) => void
        ) => {
          mixpanelTrackCalls.push({ eventName, properties });
          callback?.();
        },
        people: {
          set: (
            distinctId: string,
            properties: Record<string, unknown>,
            callback?: (error?: unknown) => void
          ) => {
            mixpanelPeopleSetCalls.push({ distinctId, properties });
            callback?.();
          },
          set_once: (
            distinctId: string,
            properties: Record<string, unknown>,
            callback?: (error?: unknown) => void
          ) => {
            mixpanelPeopleSetOnceCalls.push({ distinctId, properties });
            callback?.();
          },
          union: (
            distinctId: string,
            properties: Record<string, unknown>,
            callback?: (error?: unknown) => void
          ) => {
            mixpanelPeopleUnionCalls.push({ distinctId, properties });
            callback?.();
          },
        },
      };
    },
  },
}));

mock.module("@/lib/core/database", () => ({
  getDatabase: () => ({
    insert: () => ({
      values: (values: InsertedVoteValues) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            insertCalls.push(values);
            if (insertBehavior === "duplicate") {
              return [];
            }
            if (insertBehavior === "throw") {
              throw new Error("insert failed");
            }
            return [{ id: "vote-1" }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            groupBy: async () => [
              {
                dislikes: currentVoteTotals.dislikes,
                likes: currentVoteTotals.likes,
              },
            ],
          }),
        }),
      }),
    }),
  }),
}));

mock.module("@/lib/telegram/user-service", () => ({
  getOrCreateUser: async (...args: unknown[]) => {
    getOrCreateUserCalls.push(args);
    return userIdResult;
  },
}));

let buildSummaryVoteKeyboard: typeof import("../summary-votes").buildSummaryVoteKeyboard;
let encodeSummaryVoteCallbackData: typeof import("../summary-votes").encodeSummaryVoteCallbackData;
let handleSummaryVoteCallback: typeof import("../summary-votes").handleSummaryVoteCallback;
let parseSummaryVoteCallbackData: typeof import("../summary-votes").parseSummaryVoteCallbackData;
let SUMMARY_VOTE_CALLBACK_DATA_REGEX: typeof import("../summary-votes").SUMMARY_VOTE_CALLBACK_DATA_REGEX;
let resetBotAnalyticsStateForTests: typeof import("../analytics").__resetBotAnalyticsStateForTests;

beforeAll(async () => {
  const loadedModule = await import("../summary-votes");
  buildSummaryVoteKeyboard = loadedModule.buildSummaryVoteKeyboard;
  encodeSummaryVoteCallbackData = loadedModule.encodeSummaryVoteCallbackData;
  handleSummaryVoteCallback = loadedModule.handleSummaryVoteCallback;
  parseSummaryVoteCallbackData = loadedModule.parseSummaryVoteCallbackData;
  SUMMARY_VOTE_CALLBACK_DATA_REGEX = loadedModule.SUMMARY_VOTE_CALLBACK_DATA_REGEX;
  ({ __resetBotAnalyticsStateForTests: resetBotAnalyticsStateForTests } =
    await import("../analytics"));
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_MIXPANEL_TOKEN = "test-mixpanel-token";
  currentVoteTotals = { likes: 0, dislikes: 0 };
  insertBehavior = "inserted";
  insertCalls = [];
  getOrCreateUserCalls = [];
  userIdResult = "user-1";
  mixpanelInitTokens.length = 0;
  mixpanelTrackCalls.length = 0;
  mixpanelPeopleSetCalls.length = 0;
  mixpanelPeopleSetOnceCalls.length = 0;
  mixpanelPeopleUnionCalls.length = 0;
  resetBotAnalyticsStateForTests();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
});

describe("summary vote callback parser", () => {
  test("parses valid callback data", () => {
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
  });

  test("rejects invalid callback data", () => {
    expect(parseSummaryVoteCallbackData("sv:u:bad-id")).toBeNull();
    expect(parseSummaryVoteCallbackData("sv:u:123:-100123")).toBeNull();
    expect(parseSummaryVoteCallbackData(`sv:u:${SUMMARY_ID}`)).toBeNull();
    expect(parseSummaryVoteCallbackData("unknown")).toBeNull();
  });

  test("regex trigger only matches simplified callback format", () => {
    expect(
      SUMMARY_VOTE_CALLBACK_DATA_REGEX.test(`sv:s:${SUMMARY_ID}:${GROUP_CHAT_ID}`)
    ).toBe(true);
    expect(
      SUMMARY_VOTE_CALLBACK_DATA_REGEX.test(`sv:s:${SUMMARY_ID}`)
    ).toBe(false);
  });
});

describe("summary vote keyboard", () => {
  test("builds two rows with vote callbacks and mini app URL button", () => {
    const keyboard = buildSummaryVoteKeyboard(
      BigInt(GROUP_CHAT_ID),
      SUMMARY_ID,
      5,
      2
    );
    const rows = keyboard.inline_keyboard;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(3);
    expect(rows[1]).toHaveLength(1);

    expect(rows[0][0]?.text).toBe("Like");
    expect(rows[0][0]?.style).toBeUndefined();
    expect(rows[0][0]?.icon_custom_emoji_id).toBe(
      SUMMARY_VOTE_LIKE_CUSTOM_EMOJI_ID
    );
    expect(rows[0][0]?.callback_data).toBe(`sv:u:${SUMMARY_ID}:${GROUP_CHAT_ID}`);

    expect(rows[0][1]?.text).toBe("Score: 3");
    expect(rows[0][1]?.icon_custom_emoji_id).toBe(
      SUMMARY_SCORE_POSITIVE_CUSTOM_EMOJI_ID
    );
    expect(rows[0][1]?.callback_data).toBe(`sv:s:${SUMMARY_ID}:${GROUP_CHAT_ID}`);

    expect(rows[0][2]?.text).toBe("Dislike");
    expect(rows[0][2]?.style).toBeUndefined();
    expect(rows[0][2]?.icon_custom_emoji_id).toBe(
      SUMMARY_VOTE_DISLIKE_CUSTOM_EMOJI_ID
    );
    expect(rows[0][2]?.callback_data).toBe(`sv:d:${SUMMARY_ID}:${GROUP_CHAT_ID}`);

    expect(rows[1][0]?.text).toBe("Open");
    expect(rows[1][0]?.style).toBe("primary");
    expect(rows[1][0]?.icon_custom_emoji_id).toBe(
      SUMMARY_OPEN_BUTTON_CUSTOM_EMOJI_ID
    );
    expect(rows[1][0]?.url).toBe(
      buildSummaryFeedMiniAppUrl(GROUP_CHAT_ID, SUMMARY_ID)
    );
  });

  test("uses neutral score icon when score is zero", () => {
    const keyboard = buildSummaryVoteKeyboard(
      BigInt(GROUP_CHAT_ID),
      SUMMARY_ID,
      4,
      4
    );
    const rows = keyboard.inline_keyboard;

    expect(rows[0][1]?.text).toBe("Score: 0");
    expect(rows[0][1]?.icon_custom_emoji_id).toBe(
      SUMMARY_SCORE_ZERO_CUSTOM_EMOJI_ID
    );
  });

  test("uses negative score icon when score is below zero", () => {
    const keyboard = buildSummaryVoteKeyboard(
      BigInt(GROUP_CHAT_ID),
      SUMMARY_ID,
      1,
      3
    );
    const rows = keyboard.inline_keyboard;

    expect(rows[0][1]?.text).toBe("Score: -2");
    expect(rows[0][1]?.icon_custom_emoji_id).toBe(
      SUMMARY_SCORE_NEGATIVE_CUSTOM_EMOJI_ID
    );
  });
});

describe("handleSummaryVoteCallback", () => {
  test("shows DB-backed score alert for score button", async () => {
    currentVoteTotals = { likes: 4, dislikes: 1 };

    const answerCalls: unknown[] = [];
    const editCalls: unknown[] = [];

    const ctx = {
      answerCallbackQuery: async (payload?: unknown) => {
        answerCalls.push(payload);
      },
      api: {
        editMessageReplyMarkup: async (...args: unknown[]) => {
          editCalls.push(args);
        },
      },
      callbackQuery: {
        data: `sv:s:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
      },
    } as unknown as CallbackQueryContext<Context>;

    await handleSummaryVoteCallback(ctx);

    expect(editCalls).toHaveLength(0);
    expect(answerCalls).toEqual([
      {
        show_alert: true,
        text: "Current summary score is 3.",
      },
    ]);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("creates first vote and updates keyboard with DB totals", async () => {
    currentVoteTotals = { likes: 2, dislikes: 1 };

    const answerCalls: unknown[] = [];
    const editCalls: unknown[] = [];

    const ctx = {
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
      from: {
        first_name: "Test",
        id: 123,
        username: "tester",
      },
    } as unknown as CallbackQueryContext<Context>;

    await handleSummaryVoteCallback(ctx);

    expect(insertCalls).toEqual([
      {
        action: "LIKE",
        summaryId: SUMMARY_ID,
        userId: "user-1",
      },
    ]);
    expect(getOrCreateUserCalls).toHaveLength(1);
    expect(editCalls).toHaveLength(1);

    const [, , payload] = editCalls[0] as [
      number,
      number,
      {
        reply_markup: {
          inline_keyboard: Array<
            Array<{
              callback_data?: string;
              icon_custom_emoji_id?: string;
              style?: string;
              text?: string;
            }>
          >;
        };
      },
    ];

    expect(payload.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe(
      `sv:u:${SUMMARY_ID}:${GROUP_CHAT_ID}`
    );
    expect(payload.reply_markup.inline_keyboard[0]?.[0]?.style).toBeUndefined();
    expect(payload.reply_markup.inline_keyboard[0]?.[0]?.icon_custom_emoji_id).toBe(
      SUMMARY_VOTE_LIKE_CUSTOM_EMOJI_ID
    );
    expect(payload.reply_markup.inline_keyboard[0]?.[1]?.text).toBe("Score: 1");
    expect(payload.reply_markup.inline_keyboard[0]?.[1]?.icon_custom_emoji_id).toBe(
      SUMMARY_SCORE_POSITIVE_CUSTOM_EMOJI_ID
    );
    expect(payload.reply_markup.inline_keyboard[0]?.[1]?.callback_data).toBe(
      `sv:s:${SUMMARY_ID}:${GROUP_CHAT_ID}`
    );
    expect(payload.reply_markup.inline_keyboard[0]?.[2]?.style).toBeUndefined();
    expect(payload.reply_markup.inline_keyboard[0]?.[2]?.icon_custom_emoji_id).toBe(
      SUMMARY_VOTE_DISLIKE_CUSTOM_EMOJI_ID
    );

    expect(answerCalls).toEqual([undefined]);
    expect(mixpanelTrackCalls).toEqual([
      {
        eventName: "Bot Summary Like",
        properties: {
          workspace: "bot",
          distinct_id: "tg:123",
          group_chat_id: GROUP_CHAT_ID,
          summary_id: SUMMARY_ID,
          telegram_chat_id: "-1001234",
          telegram_chat_type: null,
          telegram_user_id: "123",
          vote_action: "LIKE",
        },
      },
    ]);
  });

  test("tracks dislike event when dislike vote is inserted", async () => {
    currentVoteTotals = { likes: 2, dislikes: 4 };

    const ctx = {
      answerCallbackQuery: async () => {},
      api: {
        editMessageReplyMarkup: async () => ({}) as never,
      },
      callbackQuery: {
        data: `sv:d:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
        message: {
          chat: { id: -1001234 },
          message_id: 99,
        },
      },
      from: {
        first_name: "Test",
        id: 123,
      },
    } as unknown as CallbackQueryContext<Context>;

    await handleSummaryVoteCallback(ctx);

    expect(mixpanelTrackCalls).toEqual([
      {
        eventName: "Bot Summary Dislike",
        properties: {
          workspace: "bot",
          distinct_id: "tg:123",
          group_chat_id: GROUP_CHAT_ID,
          summary_id: SUMMARY_ID,
          telegram_chat_id: "-1001234",
          telegram_chat_type: null,
          telegram_user_id: "123",
          vote_action: "DISLIKE",
        },
      },
    ]);
  });

  test("shows duplicate vote alert when user already voted", async () => {
    insertBehavior = "duplicate";

    const answerCalls: unknown[] = [];
    const editCalls: unknown[] = [];

    const ctx = {
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
      from: {
        first_name: "Test",
        id: 123,
      },
    } as unknown as CallbackQueryContext<Context>;

    await handleSummaryVoteCallback(ctx);

    expect(editCalls).toHaveLength(0);
    expect(answerCalls).toEqual([
      {
        cache_time: 300,
        show_alert: true,
        text: "You've voted already!",
      },
    ]);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("answers callback when vote callback has no message payload", async () => {
    const answerCalls: unknown[] = [];

    const ctx = {
      answerCallbackQuery: async (payload?: unknown) => {
        answerCalls.push(payload);
      },
      api: {
        editMessageReplyMarkup: async () => ({}) as never,
      },
      callbackQuery: {
        data: `sv:u:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
      },
      from: {
        first_name: "Test",
        id: 123,
      },
    } as unknown as CallbackQueryContext<Context>;

    await handleSummaryVoteCallback(ctx);

    expect(insertCalls).toHaveLength(0);
    expect(answerCalls).toEqual([undefined]);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("silently handles message-is-not-modified edit errors", async () => {
    currentVoteTotals = { likes: 7, dislikes: 2 };

    const answerCalls: unknown[] = [];

    const ctx = {
      answerCallbackQuery: async (payload?: unknown) => {
        answerCalls.push(payload);
      },
      api: {
        editMessageReplyMarkup: async () => {
          throw {
            description: "Bad Request: message is not modified",
          };
        },
      },
      callbackQuery: {
        data: `sv:u:${SUMMARY_ID}:${GROUP_CHAT_ID}`,
        message: {
          chat: { id: -1001234 },
          message_id: 99,
        },
      },
      from: {
        first_name: "Test",
        id: 123,
      },
    } as unknown as CallbackQueryContext<Context>;

    await handleSummaryVoteCallback(ctx);

    expect(answerCalls).toEqual([undefined]);
    expect(mixpanelTrackCalls).toEqual([
      {
        eventName: "Bot Summary Like",
        properties: {
          workspace: "bot",
          distinct_id: "tg:123",
          group_chat_id: GROUP_CHAT_ID,
          summary_id: SUMMARY_ID,
          telegram_chat_id: "-1001234",
          telegram_chat_type: null,
          telegram_user_id: "123",
          vote_action: "LIKE",
        },
      },
    ]);
  });
});
