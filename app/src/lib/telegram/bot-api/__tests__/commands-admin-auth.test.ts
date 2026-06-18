import type { Community } from "@loyal-labs/db-core/schema";
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CommandContext, Context } from "grammy";

mock.module("server-only", () => ({}));

let mockDb: {
  insert: () => {
    values: (values: Record<string, unknown>) => {
      onConflictDoNothing: () => {
        returning: () => Promise<Array<{ id: string }>>;
      };
    };
  };
  query: {
    admins: { findFirst: () => Promise<{ id: string } | null> };
    communities: { findFirst: () => Promise<Community | null> };
  };
  update: () => {
    set: (values: Record<string, unknown>) => {
      where: () => Promise<void>;
    };
  };
};

let captureCommunityPhotoCalls: Array<bigint | number | string> = [];
let evictCalls: Array<bigint | number | string> = [];
let notificationSettingsCalls: Community[] = [];

mock.module("@/lib/core/database", () => ({
  getDatabase: () => mockDb,
}));

mock.module("@/lib/telegram/community-photo-service", () => ({
  captureCommunityPhotoToCdn: async (chatId: bigint | number | string) => {
    captureCommunityPhotoCalls.push(chatId);
    return "https://cdn.example.com/community-avatar.jpg";
  },
}));

mock.module("@/lib/telegram/user-service", () => ({
  getOrCreateUser: async () => "user-1",
}));

mock.module("../message-handlers", () => ({
  evictActiveCommunityCache: (chatId: bigint | number | string) => {
    evictCalls.push(chatId);
  },
}));

mock.module("../helper-message-cleanup", () => ({
  replyWithAutoCleanup: async (ctx: CommandContext<Context>, text: string) => {
    await ctx.reply(text);
  },
}));

mock.module("../notification-settings", () => ({
  sendNotificationSettingsMessage: async (
    _ctx: CommandContext<Context>,
    community: Community
  ) => {
    notificationSettingsCalls.push(community);
  },
}));

let handleActivateCommunityCommand: (
  ctx: CommandContext<Context>
) => Promise<void>;
let handleDeactivateCommunityCommand: (
  ctx: CommandContext<Context>
) => Promise<void>;
let handleHideCommunityCommand: (ctx: CommandContext<Context>) => Promise<void>;
let handleNotificationsCommand: (ctx: CommandContext<Context>) => Promise<void>;
let handleUnhideCommunityCommand: (
  ctx: CommandContext<Context>
) => Promise<void>;

let adminResult: { id: string } | null;
let communityFindResults: Array<Community | null>;
let insertReturningRows: Array<{ id: string }>;
let insertValuesCaptured: Array<Record<string, unknown>>;
let updateValuesCaptured: Array<Record<string, unknown>>;

function createCommunity(overrides?: Partial<Community>): Community {
  return {
    activatedAt: new Date("2026-02-12T00:00:00.000Z"),
    activatedBy: BigInt("123456789"),
    chatId: BigInt("-1009876543210"),
    chatTitle: "Test Community",
    id: "550e8400-e29b-41d4-a716-446655440000",
    isActive: true,
    isPublic: true,
    parserType: "bot",
    settings: {},
    summaryNotificationMessageCount: null,
    summaryNotificationTimeHours: 24,
    summaryNotificationsEnabled: true,
    updatedAt: new Date("2026-02-12T00:00:00.000Z"),
    ...overrides,
  };
}

function createCommandContext() {
  const replyCalls: string[] = [];

  const ctx = {
    chat: {
      id: -1009876543210,
      title: "Test Community",
      type: "supergroup",
    },
    deleteMessage: async () => true as const,
    from: {
      first_name: "Admin",
      id: 777,
      username: "admin_user",
    },
    reply: async (text: string) => {
      replyCalls.push(text);
      return {} as never;
    },
  } as unknown as CommandContext<Context>;

  return { ctx, replyCalls };
}

describe("commands admin authorization", () => {
  beforeAll(async () => {
    const loadedModule = await import("../commands");
    handleActivateCommunityCommand =
      loadedModule.handleActivateCommunityCommand;
    handleDeactivateCommunityCommand =
      loadedModule.handleDeactivateCommunityCommand;
    handleHideCommunityCommand = loadedModule.handleHideCommunityCommand;
    handleNotificationsCommand = loadedModule.handleNotificationsCommand;
    handleUnhideCommunityCommand = loadedModule.handleUnhideCommunityCommand;
  });

  beforeEach(() => {
    adminResult = null;
    communityFindResults = [];
    insertReturningRows = [{ id: "new-community" }];
    captureCommunityPhotoCalls = [];
    evictCalls = [];
    notificationSettingsCalls = [];
    insertValuesCaptured = [];
    updateValuesCaptured = [];

    mockDb = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          insertValuesCaptured.push(values);
          return {
            onConflictDoNothing: () => ({
              returning: async () => insertReturningRows,
            }),
          };
        },
      }),
      query: {
        admins: {
          findFirst: async () => adminResult,
        },
        communities: {
          findFirst: async () => communityFindResults.shift() ?? null,
        },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updateValuesCaptured.push(values);
          return {
            where: async () => {},
          };
        },
      }),
    };
  });

  test("rejects non-whitelisted admin commands before writes or replies", async () => {
    const { ctx, replyCalls } = createCommandContext();

    await handleActivateCommunityCommand(ctx);
    await handleDeactivateCommunityCommand(ctx);
    await handleHideCommunityCommand(ctx);

    expect(insertValuesCaptured).toHaveLength(0);
    expect(updateValuesCaptured).toHaveLength(0);
    expect(evictCalls).toHaveLength(0);
    expect(replyCalls).toHaveLength(0);
  });

  test("creates new communities inactive-public safe by default", async () => {
    adminResult = { id: "admin-1" };
    const { ctx } = createCommandContext();

    await handleActivateCommunityCommand(ctx);

    expect(captureCommunityPhotoCalls).toEqual([ctx.chat.id]);
    expect(insertValuesCaptured).toHaveLength(1);
    expect(insertValuesCaptured[0]?.isPublic).toBe(false);
    expect(updateValuesCaptured).toHaveLength(0);
  });

  test("reactivates the row when activation races an existing inactive community", async () => {
    adminResult = { id: "admin-1" };
    communityFindResults = [null, createCommunity({ isActive: false })];
    insertReturningRows = [];
    const { ctx } = createCommandContext();

    await handleActivateCommunityCommand(ctx);

    expect(insertValuesCaptured).toHaveLength(1);
    expect(updateValuesCaptured).toHaveLength(1);
    expect(updateValuesCaptured[0]?.isActive).toBe(true);
  });

  test("deactivation disables tracking and evicts active community cache", async () => {
    adminResult = { id: "admin-1" };
    communityFindResults = [createCommunity({ isActive: true })];
    const { ctx } = createCommandContext();

    await handleDeactivateCommunityCommand(ctx);

    expect(updateValuesCaptured).toHaveLength(1);
    expect(updateValuesCaptured[0]?.isActive).toBe(false);
    expect(evictCalls).toEqual([BigInt(ctx.chat.id)]);
  });

  test("hide and unhide mutate only active rows that need a visibility change", async () => {
    adminResult = { id: "admin-1" };
    communityFindResults = [
      createCommunity({ isActive: true, isPublic: true }),
      createCommunity({ isActive: true, isPublic: false }),
      createCommunity({ isActive: true, isPublic: false }),
    ];
    const { ctx } = createCommandContext();

    await handleHideCommunityCommand(ctx);
    await handleUnhideCommunityCommand(ctx);
    await handleHideCommunityCommand(ctx);

    expect(updateValuesCaptured.map((values) => values.isPublic)).toEqual([
      false,
      true,
    ]);
  });

  test("notifications dispatch only for whitelisted active communities", async () => {
    adminResult = { id: "admin-1" };
    const activeCommunity = createCommunity({ isActive: true });
    communityFindResults = [
      activeCommunity,
      createCommunity({ isActive: false }),
    ];
    const { ctx } = createCommandContext();

    await handleNotificationsCommand(ctx);
    await handleNotificationsCommand(ctx);

    expect(notificationSettingsCalls).toEqual([activeCommunity]);
  });
});
