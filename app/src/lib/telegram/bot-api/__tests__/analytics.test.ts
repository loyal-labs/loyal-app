import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

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

let analytics: typeof import("../analytics");

describe("bot analytics helpers", () => {
  beforeAll(async () => {
    analytics = await import("../analytics");
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN = "test-mixpanel-token";
    mixpanelInitTokens.length = 0;
    mixpanelTrackCalls.length = 0;
    mixpanelPeopleSetCalls.length = 0;
    mixpanelPeopleSetOnceCalls.length = 0;
    mixpanelPeopleUnionCalls.length = 0;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
  });

  test("tracks bot events with workspace and updates profile adoption for users", () => {
    analytics.trackBotEvent(
      "Bot /start Command",
      analytics.createBotTrackingProperties({
        chatId: -1009876543210,
        chatType: "supergroup",
        userId: 123456789,
      })
    );

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

  test("skips profile adoption updates when only a chat fallback distinct id exists", () => {
    analytics.trackBotEvent(
      "Bot Added to Group",
      analytics.createBotTrackingProperties({
        chatId: -1009876543210,
        chatType: "supergroup",
      })
    );

    expect(mixpanelTrackCalls).toEqual([
      {
        eventName: "Bot Added to Group",
        properties: {
          workspace: "bot",
          distinct_id: "tg-chat:-1009876543210",
          telegram_chat_id: "-1009876543210",
          telegram_chat_type: "supergroup",
          telegram_user_id: null,
        },
      },
    ]);
    expect(mixpanelPeopleUnionCalls).toHaveLength(0);
    expect(mixpanelPeopleSetOnceCalls).toHaveLength(0);
    expect(mixpanelPeopleSetCalls).toHaveLength(0);
  });
});
