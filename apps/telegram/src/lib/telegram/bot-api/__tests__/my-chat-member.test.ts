import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Context } from "grammy";

mock.module("server-only", () => ({}));

let mockDb: {
  insert: () => {
    values: (values: Record<string, unknown>) => {
      onConflictDoNothing?: () => {
        returning: () => Promise<Array<{ id: string }>>;
      };
      onConflictDoUpdate?: (config: {
        set: Record<string, unknown>;
        target: unknown;
      }) => Promise<void>;
    };
  };
  update: () => {
    set: (values: Record<string, unknown>) => {
      where: () => Promise<void>;
    };
  };
};

let evictCalls: Array<bigint | number | string> = [];

let upsertShouldThrow = false;
let removalUpdateShouldThrow = false;
let insertValuesCaptured: Array<Record<string, unknown>>;
let conflictSetCaptured: Array<Record<string, unknown>>;
let conflictTargetCaptured: unknown[] = [];
let removalUpdateValuesCaptured: Array<Record<string, unknown>>;
let removalWhereCalls = 0;
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
const getOrCreateUserCalls: Array<{
  telegramId: bigint;
  userData: {
    username: string | null;
    displayName: string;
  };
  options?: {
    backfillAvatar?: boolean;
  };
}> = [];
let privateUserSettingsDisableValuesCaptured: Array<Record<string, unknown>> =
  [];
let sendMessageWithAutoCleanupCalls: Array<{
  chatId: bigint | number | string;
  chatType: string;
  text: string;
}> = [];

mock.module("@/lib/core/database", () => ({
  getDatabase: () => mockDb,
}));

mock.module("mixpanel", () => ({
  default: {
    init: () => {
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

mock.module("../message-handlers", () => ({
  evictActiveCommunityCache: (chatId: bigint | number | string) => {
    evictCalls.push(chatId);
  },
}));

mock.module("@/lib/telegram/user-service", () => ({
  getOrCreateUser: async (
    telegramId: bigint,
    userData: {
      username: string | null;
      displayName: string;
    },
    options?: {
      backfillAvatar?: boolean;
    }
  ) => {
    getOrCreateUserCalls.push({ telegramId, userData, options });
    return "private-user-id";
  },
}));

mock.module("../helper-message-cleanup", () => ({
  sendMessageWithAutoCleanup: async (params: {
    api: Pick<Context["api"], "sendMessage">;
    chatId: bigint | number | string;
    chatType: string;
    text: string;
    options?: unknown;
  }) => {
    sendMessageWithAutoCleanupCalls.push({
      chatId: params.chatId,
      chatType: params.chatType,
      text: params.text,
    });
    await params.api.sendMessage(
      params.chatId,
      params.text,
      params.options as never
    );
  },
}));

let handleMyChatMemberUpdate: (ctx: Context) => Promise<void>;
let resetBotAnalyticsStateForTests: typeof import("../analytics").__resetBotAnalyticsStateForTests;

const COMMUNITY_CHAT_ID = -1009876543210;
const BOT_ADDED_TO_GROUP_EVENT = "Bot Added to Group";
const BOT_REMOVED_FROM_GROUP_EVENT = "Bot Removed from Group";
const BOT_BLOCKED_BY_USER_EVENT = "Bot Blocked by User";

function createContext(options: {
  chatType: "group" | "supergroup" | "channel" | "private";
  newStatus:
    | "administrator"
    | "creator"
    | "kicked"
    | "left"
    | "member"
    | "restricted";
  oldStatus:
    | "administrator"
    | "creator"
    | "kicked"
    | "left"
    | "member"
    | "restricted";
  sendMessageShouldThrow?: boolean;
}) {
  const sendMessageCalls: Array<{ chatId: number | string; text: string }> = [];

  const ctx = {
    api: {
      sendMessage: async (chatId: number | string, text: string) => {
        sendMessageCalls.push({ chatId, text });
        if (options.sendMessageShouldThrow) {
          throw new Error("send failed");
        }
        return {} as never;
      },
    },
    update: {
      my_chat_member: {
        chat: {
          id: COMMUNITY_CHAT_ID,
          title: "New Community Title",
          type: options.chatType,
        },
        from: {
          id: 777,
          first_name: "Taylor",
          last_name: "Agent",
          username: "taylor",
        },
        new_chat_member: {
          status: options.newStatus,
        },
        old_chat_member: {
          status: options.oldStatus,
        },
      },
    },
  } as unknown as Context;

  return { ctx, sendMessageCalls };
}

describe("my chat member onboarding", () => {
  beforeAll(async () => {
    const loadedModule = await import("../my-chat-member");
    handleMyChatMemberUpdate = loadedModule.handleMyChatMemberUpdate;
    ({ __resetBotAnalyticsStateForTests: resetBotAnalyticsStateForTests } =
      await import("../analytics"));
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN = "test-mixpanel-token";
    upsertShouldThrow = false;
    removalUpdateShouldThrow = false;
    evictCalls = [];
    insertValuesCaptured = [];
    conflictSetCaptured = [];
    conflictTargetCaptured = [];
    removalUpdateValuesCaptured = [];
    removalWhereCalls = 0;
    mixpanelTrackCalls.length = 0;
    mixpanelPeopleSetCalls.length = 0;
    mixpanelPeopleSetOnceCalls.length = 0;
    mixpanelPeopleUnionCalls.length = 0;
    getOrCreateUserCalls.length = 0;
    privateUserSettingsDisableValuesCaptured = [];
    sendMessageWithAutoCleanupCalls = [];
    resetBotAnalyticsStateForTests();

    mockDb = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          if ("chatId" in values) {
            insertValuesCaptured.push(values);
            return {
              onConflictDoUpdate: async (config) => {
                conflictSetCaptured.push(config.set);
                conflictTargetCaptured.push(config.target);
                if (upsertShouldThrow) {
                  throw new Error("upsert failed");
                }
              },
            };
          }

          if ("userId" in values && "notifications" in values) {
            privateUserSettingsDisableValuesCaptured.push(values);
            return {
              onConflictDoUpdate: async () => {},
            };
          }

          throw new Error("Unexpected insert payload");
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          removalUpdateValuesCaptured.push(values);
          return {
            where: async () => {
              removalWhereCalls += 1;
              if (removalUpdateShouldThrow) {
                throw new Error("removal update failed");
              }
            },
          };
        },
      }),
    };
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
  });

  test("upserts inactive hidden community when bot is freshly added", async () => {
    const { ctx, sendMessageCalls } = createContext({
      chatType: "supergroup",
      oldStatus: "left",
      newStatus: "member",
    });

    await handleMyChatMemberUpdate(ctx);

    expect(insertValuesCaptured).toHaveLength(1);
    expect(removalUpdateValuesCaptured).toHaveLength(0);
    expect(insertValuesCaptured[0]?.chatId).toBe(BigInt(COMMUNITY_CHAT_ID));
    expect(insertValuesCaptured[0]?.isActive).toBe(false);
    expect(insertValuesCaptured[0]?.isPublic).toBe(false);
    expect(conflictSetCaptured).toHaveLength(1);
    expect(conflictSetCaptured[0]?.isActive).toBe(false);
    expect(conflictSetCaptured[0]?.isPublic).toBe(false);
    expect(conflictTargetCaptured).toHaveLength(1);
    expect(evictCalls).toEqual([BigInt(COMMUNITY_CHAT_ID)]);
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageWithAutoCleanupCalls).toHaveLength(1);
    expect(mixpanelTrackCalls[0]?.eventName).toBe(BOT_ADDED_TO_GROUP_EVENT);
  });

  test("ignores non-join status transitions", async () => {
    const { ctx, sendMessageCalls } = createContext({
      chatType: "supergroup",
      oldStatus: "member",
      newStatus: "administrator",
    });

    await handleMyChatMemberUpdate(ctx);

    expect(insertValuesCaptured).toHaveLength(0);
    expect(removalUpdateValuesCaptured).toHaveLength(0);
    expect(conflictSetCaptured).toHaveLength(0);
    expect(evictCalls).toHaveLength(0);
    expect(sendMessageCalls).toHaveLength(0);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("tracks private member -> kicked as bot blocked by user", async () => {
    const { ctx, sendMessageCalls } = createContext({
      chatType: "private",
      oldStatus: "member",
      newStatus: "kicked",
    });

    await handleMyChatMemberUpdate(ctx);

    expect(insertValuesCaptured).toHaveLength(0);
    expect(removalUpdateValuesCaptured).toHaveLength(0);
    expect(conflictSetCaptured).toHaveLength(0);
    expect(evictCalls).toHaveLength(0);
    expect(sendMessageCalls).toHaveLength(0);
    expect(getOrCreateUserCalls).toHaveLength(1);
    expect(privateUserSettingsDisableValuesCaptured).toHaveLength(1);
    expect(privateUserSettingsDisableValuesCaptured[0]?.notifications).toBe(
      false
    );
    expect(mixpanelTrackCalls[0]?.eventName).toBe(BOT_BLOCKED_BY_USER_EVENT);
  });

  test("ignores private transitions that are not block or unblock", async () => {
    const { ctx, sendMessageCalls } = createContext({
      chatType: "private",
      oldStatus: "left",
      newStatus: "member",
    });

    await handleMyChatMemberUpdate(ctx);

    expect(insertValuesCaptured).toHaveLength(0);
    expect(removalUpdateValuesCaptured).toHaveLength(0);
    expect(conflictSetCaptured).toHaveLength(0);
    expect(evictCalls).toHaveLength(0);
    expect(sendMessageCalls).toHaveLength(0);
    expect(getOrCreateUserCalls).toHaveLength(0);
    expect(privateUserSettingsDisableValuesCaptured).toHaveLength(0);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("evicts cache and does not crash when upsert fails", async () => {
    upsertShouldThrow = true;
    const { ctx, sendMessageCalls } = createContext({
      chatType: "group",
      oldStatus: "left",
      newStatus: "member",
    });
    const consoleErrorMock = mock(() => undefined);
    const previousConsoleError = console.error;
    console.error = consoleErrorMock;

    try {
      await handleMyChatMemberUpdate(ctx);
    } finally {
      console.error = previousConsoleError;
    }

    expect(insertValuesCaptured).toHaveLength(1);
    expect(removalUpdateValuesCaptured).toHaveLength(0);
    expect(evictCalls).toEqual([BigInt(COMMUNITY_CHAT_ID)]);
    expect(sendMessageCalls).toHaveLength(0);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });

  test("logs onboarding send failures without reverting upsert intent", async () => {
    const { ctx } = createContext({
      chatType: "group",
      oldStatus: "left",
      newStatus: "member",
      sendMessageShouldThrow: true,
    });
    const consoleErrorMock = mock(() => undefined);
    const previousConsoleError = console.error;
    console.error = consoleErrorMock;

    try {
      await handleMyChatMemberUpdate(ctx);
    } finally {
      console.error = previousConsoleError;
    }

    expect(insertValuesCaptured).toHaveLength(1);
    expect(removalUpdateValuesCaptured).toHaveLength(0);
    expect(conflictSetCaptured).toHaveLength(1);
    expect(evictCalls).toEqual([BigInt(COMMUNITY_CHAT_ID)]);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);
    expect(mixpanelTrackCalls[0]?.eventName).toBe(BOT_ADDED_TO_GROUP_EVENT);
  });

  test("handles removal member -> left by deactivating and hiding without onboarding message", async () => {
    const { ctx, sendMessageCalls } = createContext({
      chatType: "supergroup",
      oldStatus: "member",
      newStatus: "left",
    });

    await handleMyChatMemberUpdate(ctx);

    expect(insertValuesCaptured).toHaveLength(0);
    expect(conflictSetCaptured).toHaveLength(0);
    expect(removalUpdateValuesCaptured).toHaveLength(1);
    expect(removalUpdateValuesCaptured[0]?.isActive).toBe(false);
    expect(removalUpdateValuesCaptured[0]?.isPublic).toBe(false);
    expect(removalWhereCalls).toBe(1);
    expect(evictCalls).toEqual([BigInt(COMMUNITY_CHAT_ID)]);
    expect(sendMessageCalls).toHaveLength(0);
    expect(mixpanelTrackCalls[0]?.eventName).toBe(BOT_REMOVED_FROM_GROUP_EVENT);
  });

  test("evicts cache and does not crash when removal update fails", async () => {
    removalUpdateShouldThrow = true;
    const { ctx, sendMessageCalls } = createContext({
      chatType: "group",
      oldStatus: "member",
      newStatus: "left",
    });
    const consoleErrorMock = mock(() => undefined);
    const previousConsoleError = console.error;
    console.error = consoleErrorMock;

    try {
      await handleMyChatMemberUpdate(ctx);
    } finally {
      console.error = previousConsoleError;
    }

    expect(insertValuesCaptured).toHaveLength(0);
    expect(removalUpdateValuesCaptured).toHaveLength(1);
    expect(evictCalls).toEqual([BigInt(COMMUNITY_CHAT_ID)]);
    expect(sendMessageCalls).toHaveLength(0);
    expect(consoleErrorMock).toHaveBeenCalledTimes(1);
    expect(mixpanelTrackCalls).toHaveLength(0);
  });
});
