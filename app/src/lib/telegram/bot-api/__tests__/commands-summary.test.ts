import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Bot, CommandContext, Context } from "grammy";

mock.module("server-only", () => ({}));

type MockSendSummaryResult =
  | { sent: true }
  | {
      sent: false;
      reason: "no_summaries" | "not_activated" | "notifications_disabled";
    };

let sendLatestSummaryResult: MockSendSummaryResult = { sent: true };
let sendLatestSummaryError: Error | null = null;
const sendLatestSummaryCalls: unknown[] = [];
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
let sendStartCarouselShouldThrow = false;
let sendStartCarouselCalls = 0;
let autoCleanupReplyTexts: string[] = [];

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
  getDatabase: () => ({}),
}));

mock.module("../get-chat", () => ({
  getChat: async () => ({}),
}));

mock.module("../get-file", () => ({
  downloadTelegramFile: async () => ({
    body: Buffer.from(""),
    contentType: "image/jpeg",
  }),
}));

mock.module("@/lib/telegram/user-service", () => ({
  getOrCreateUser: async () => "user-1",
}));

mock.module("../start-carousel", () => ({
  sendStartCarousel: async () => {
    sendStartCarouselCalls += 1;
    if (sendStartCarouselShouldThrow) {
      throw new Error("start carousel failed");
    }
  },
}));

mock.module("../summaries", () => ({
  sendLatestSummary: async (...args: unknown[]) => {
    sendLatestSummaryCalls.push(args);
    if (sendLatestSummaryError) {
      throw sendLatestSummaryError;
    }
    return sendLatestSummaryResult;
  },
}));

mock.module("../helper-message-cleanup", () => ({
  replyWithAutoCleanup: async (
    ctx: CommandContext<Context>,
    text: string,
    options?: unknown
  ) => {
    autoCleanupReplyTexts.push(text);
    await ctx.reply(text, options as never);
  },
  sendMessageWithAutoCleanup: async () => {},
}));

let handleStartCommand: typeof import("../commands").handleStartCommand;
let handleSummaryCommand: typeof import("../commands").handleSummaryCommand;
let resetBotAnalyticsStateForTests: typeof import("../analytics").__resetBotAnalyticsStateForTests;

function createStartCommandContext() {
  const ctx = {
    chat: {
      id: -1009876543210,
      type: "supergroup",
    },
    from: {
      id: 123456789,
    },
  } as unknown as CommandContext<Context>;

  return { ctx };
}

function createSummaryCommandContext() {
  const replyCalls: string[] = [];

  const ctx = {
    chat: {
      id: -1009876543210,
      type: "supergroup",
    },
    msg: {
      message_id: 789,
    },
    from: {
      id: 123456789,
    },
    reply: async (text: string) => {
      replyCalls.push(text);
      return {} as never;
    },
  } as unknown as CommandContext<Context>;

  return { ctx, replyCalls };
}

describe("commands analytics tracking", () => {
  beforeAll(async () => {
    const loadedModule = await import("../commands");
    handleStartCommand = loadedModule.handleStartCommand;
    handleSummaryCommand = loadedModule.handleSummaryCommand;
    ({ __resetBotAnalyticsStateForTests: resetBotAnalyticsStateForTests } =
      await import("../analytics"));
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN = "test-mixpanel-token";
    sendLatestSummaryResult = { sent: true };
    sendLatestSummaryError = null;
    sendLatestSummaryCalls.length = 0;
    mixpanelInitTokens.length = 0;
    mixpanelTrackCalls.length = 0;
    mixpanelPeopleSetCalls.length = 0;
    mixpanelPeopleSetOnceCalls.length = 0;
    mixpanelPeopleUnionCalls.length = 0;
    sendStartCarouselCalls = 0;
    sendStartCarouselShouldThrow = false;
    autoCleanupReplyTexts = [];
    resetBotAnalyticsStateForTests();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
  });

  test("tracks /start only when start response succeeds", async () => {
    const { ctx } = createStartCommandContext();

    await handleStartCommand(ctx, {} as Bot);

    expect(sendStartCarouselCalls).toBe(1);
    expect(mixpanelInitTokens).toEqual(["test-mixpanel-token"]);
    expect(mixpanelTrackCalls).toEqual([
      {
        eventName: "Bot /start Command",
        properties: {
          workspace: "bot",
          distinct_id: "tg:123456789",
          telegram_chat_id: "-1009876543210",
          telegram_chat_type: "supergroup",
          telegram_user_id: "123456789",
        },
      },
    ]);
    expect(mixpanelPeopleUnionCalls).toEqual([
      {
        distinctId: "tg:123456789",
        properties: {
          workspaces: ["bot"],
        },
      },
    ]);
    expect(mixpanelPeopleSetOnceCalls).toEqual([
      {
        distinctId: "tg:123456789",
        properties: {
          first_workspace: "bot",
          bot_first_seen_at: expect.any(String),
        },
      },
    ]);
    expect(mixpanelPeopleSetCalls).toEqual([
      {
        distinctId: "tg:123456789",
        properties: {
          last_workspace: "bot",
          bot_last_seen_at: expect.any(String),
        },
      },
    ]);
  });

  test("does not track /start when start response fails", async () => {
    sendStartCarouselShouldThrow = true;
    const { ctx } = createStartCommandContext();

    await expect(handleStartCommand(ctx, {} as Bot)).rejects.toThrow(
      "start carousel failed"
    );

    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("tracks /summary when summary is sent successfully", async () => {
    sendLatestSummaryResult = { sent: true };
    const { ctx, replyCalls } = createSummaryCommandContext();

    await handleSummaryCommand(ctx, {} as Bot);

    expect(replyCalls).toHaveLength(0);
    expect(mixpanelTrackCalls).toEqual([
      {
        eventName: "Bot /summary Command",
        properties: {
          workspace: "bot",
          distinct_id: "tg:123456789",
          summary_destination_chat_id: "-1009876543210",
          summary_source_chat_id: "-1009876543210",
          telegram_chat_id: "-1009876543210",
          telegram_chat_type: "supergroup",
          telegram_user_id: "123456789",
        },
      },
    ]);
  });

  test("suppresses reply when summary notifications are disabled for community", async () => {
    sendLatestSummaryResult = {
      sent: false,
      reason: "notifications_disabled",
    };
    const { ctx, replyCalls } = createSummaryCommandContext();

    await handleSummaryCommand(ctx, {} as Bot);

    expect(replyCalls).toHaveLength(0);
    expect(autoCleanupReplyTexts).toHaveLength(0);
    expect(sendLatestSummaryCalls).toHaveLength(1);
    expect(sendLatestSummaryCalls[0]).toEqual([
      {},
      BigInt(-1009876543210),
      {
        destinationChatId: BigInt(-1009876543210),
        replyToMessageId: 789,
      },
    ]);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("suppresses reply when community is not activated", async () => {
    sendLatestSummaryResult = {
      sent: false,
      reason: "not_activated",
    };
    const { ctx, replyCalls } = createSummaryCommandContext();

    await handleSummaryCommand(ctx, {} as Bot);

    expect(replyCalls).toHaveLength(0);
    expect(autoCleanupReplyTexts).toHaveLength(0);
  });

  test("suppresses reply when no summaries are available", async () => {
    sendLatestSummaryResult = {
      sent: false,
      reason: "no_summaries",
    };
    const { ctx, replyCalls } = createSummaryCommandContext();

    await handleSummaryCommand(ctx, {} as Bot);

    expect(replyCalls).toHaveLength(0);
    expect(autoCleanupReplyTexts).toHaveLength(0);
  });

  test("suppresses reply when summary delivery throws", async () => {
    sendLatestSummaryError = new Error("summary delivery failed");
    const { ctx, replyCalls } = createSummaryCommandContext();

    await handleSummaryCommand(ctx, {} as Bot);

    expect(replyCalls).toHaveLength(0);
    expect(autoCleanupReplyTexts).toHaveLength(0);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });
});
