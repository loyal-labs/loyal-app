import { describe, expect, test } from "bun:test";

import { runSyncOnce, runSyncOnceCli } from "../commands/sync-once";
import type { UserbotConfig } from "../lib/env";

type FakeLogger = {
  error: (..._args: unknown[]) => void;
  info: (..._args: unknown[]) => void;
  warn: (..._args: unknown[]) => void;
};

type CommunityRecord = {
  chatId: bigint;
  chatTitle: string;
  id: string;
  parserType: "bot" | "userbot";
};

type MessageRecord = {
  date: Date;
  id: number;
  isService: boolean;
  media: { type: string } | null;
  sender?: {
    displayName?: string | null;
    id: number;
    type: string;
    username?: string | null;
  } | null;
  text: string;
};

type FakeState = {
  communities: CommunityRecord[];
  existingMembershipKeys: Set<string>;
  existingMessageKeys: Set<string>;
  existingCommunityChatIds: Set<string>;
  getHistoryCalls: Array<{ chatId: number; limit: number }>;
  getMessagesCalls: Array<{ chatId: number; firstId: number; size: number }>;
  getMessagesResponsesByFirstId: Map<number, Array<unknown | null>>;
  getHistoryLimitOneFailCount: number;
  incrementalHistory: unknown[];
  initialHistory: unknown[];
  insertedCommunityRows: Array<{
    activatedBy: bigint;
    chatId: bigint;
    chatTitle: string;
    isActive: boolean;
    isPublic: boolean;
    parserType: "userbot";
    summaryNotificationMessageCount: null;
    summaryNotificationTimeHours: null;
    summaryNotificationsEnabled: boolean;
  }>;
  insertedMembershipRows: number;
  insertedMessageRows: number;
  insertedUserRows: number;
  iterDialogsCalls: Array<{ archived: string | undefined }>;
  iterDialogsEntries: unknown[];
  iterHistoryCalls: Array<{ chatId: number; minId: number }>;
  latestStoredMessageId: bigint | null;
  latestTelegramMessageId: number | null;
  startedAccountId: bigint | number;
  usersByTelegramId: Map<
    string,
    { displayName: string; id: string; username: string | null }
  >;
};

function createLogger(): FakeLogger {
  return {
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

function createConfig(): UserbotConfig {
  return {
    accountKey: "primary",
    authMode: "user",
    apiHash: "hash",
    apiId: 123,
    botToken: null,
    storageDir: "/tmp/userbot",
  };
}

function createFakeState(
  overrides: Partial<
    Omit<
      FakeState,
      | "existingMembershipKeys"
      | "existingMessageKeys"
      | "existingCommunityChatIds"
      | "getHistoryCalls"
      | "getMessagesCalls"
      | "insertedCommunityRows"
      | "insertedMembershipRows"
      | "insertedMessageRows"
      | "insertedUserRows"
      | "iterDialogsCalls"
      | "iterHistoryCalls"
      | "usersByTelegramId"
    >
  > = {}
): FakeState {
  const existingCommunities = overrides.communities ?? [];

  return {
    communities: existingCommunities,
    existingMembershipKeys: new Set<string>(),
    existingMessageKeys: new Set<string>(),
    existingCommunityChatIds: new Set(
      existingCommunities.map((community) => community.chatId.toString())
    ),
    getHistoryCalls: [],
    getMessagesCalls: [],
    getMessagesResponsesByFirstId:
      overrides.getMessagesResponsesByFirstId ??
      new Map<number, Array<unknown | null>>(),
    getHistoryLimitOneFailCount: overrides.getHistoryLimitOneFailCount ?? 0,
    incrementalHistory: overrides.incrementalHistory ?? [],
    initialHistory: overrides.initialHistory ?? [],
    insertedCommunityRows: [],
    insertedMembershipRows: 0,
    insertedMessageRows: 0,
    insertedUserRows: 0,
    iterDialogsCalls: [],
    iterDialogsEntries: overrides.iterDialogsEntries ?? [],
    iterHistoryCalls: [],
    latestStoredMessageId:
      overrides.latestStoredMessageId === undefined
        ? null
        : overrides.latestStoredMessageId,
    latestTelegramMessageId:
      overrides.latestTelegramMessageId === undefined
        ? null
        : overrides.latestTelegramMessageId,
    startedAccountId: overrides.startedAccountId ?? 1,
    usersByTelegramId: new Map<
      string,
      { displayName: string; id: string; username: string | null }
    >(),
  };
}

function createFakeDb(state: FakeState): any {
  return {
    query: {
      communities: {
        findMany: async () => state.communities,
      },
      messages: {
        findFirst: async () =>
          state.latestStoredMessageId === null
            ? null
            : { telegramMessageId: state.latestStoredMessageId },
      },
      users: {
        findFirst: async () => {
          const first = state.usersByTelegramId.values().next();
          if (first.done) {
            return null;
          }

          return first.value;
        },
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if ("telegramId" in values) {
              const telegramId = String(values.telegramId);
              const existing = state.usersByTelegramId.get(telegramId);
              if (existing) {
                return [];
              }

              const newUser = {
                displayName: String(values.displayName),
                id: `user-${state.usersByTelegramId.size + 1}`,
                username:
                  values.username === null
                    ? null
                    : (values.username as string | null),
              };
              state.usersByTelegramId.set(telegramId, newUser);
              state.insertedUserRows += 1;
              return [{ id: newUser.id }];
            }

            if (
              "communityId" in values &&
              "userId" in values &&
              !("content" in values)
            ) {
              const key = `${values.communityId}:${values.userId}`;
              if (state.existingMembershipKeys.has(key)) {
                return [];
              }

              state.existingMembershipKeys.add(key);
              state.insertedMembershipRows += 1;
              return [
                { id: `community-member-${state.insertedMembershipRows}` },
              ];
            }

            if ("content" in values && "telegramMessageId" in values) {
              const key = `${values.communityId}:${String(
                values.telegramMessageId
              )}`;
              if (state.existingMessageKeys.has(key)) {
                return [];
              }

              state.existingMessageKeys.add(key);
              state.insertedMessageRows += 1;
              return [{ id: `message-${state.insertedMessageRows}` }];
            }

            if (
              "chatId" in values &&
              "activatedBy" in values &&
              "parserType" in values &&
              !("communityId" in values)
            ) {
              const chatId = BigInt(values.chatId as bigint | number | string);
              const chatIdKey = chatId.toString();
              if (state.existingCommunityChatIds.has(chatIdKey)) {
                return [];
              }

              state.existingCommunityChatIds.add(chatIdKey);
              state.insertedCommunityRows.push({
                activatedBy: BigInt(
                  values.activatedBy as bigint | number | string
                ),
                chatId,
                chatTitle: String(values.chatTitle),
                isActive: Boolean(values.isActive),
                isPublic: Boolean(values.isPublic),
                parserType: "userbot",
                summaryNotificationMessageCount:
                  (values.summaryNotificationMessageCount as null) ?? null,
                summaryNotificationTimeHours:
                  (values.summaryNotificationTimeHours as null) ?? null,
                summaryNotificationsEnabled: Boolean(
                  values.summaryNotificationsEnabled
                ),
              });
              return [
                { id: `community-${state.insertedCommunityRows.length}` },
              ];
            }

            return [];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  };
}

function createFakeBundle(
  state: FakeState,
  config: UserbotConfig = createConfig()
): any {
  return {
    client: {
      destroy: async () => undefined,
      getHistory: async (chatId: number, params?: { limit?: number }) => {
        const limit = params?.limit ?? 0;
        state.getHistoryCalls.push({ chatId, limit });

        if (limit === 1) {
          if (state.getHistoryLimitOneFailCount > 0) {
            state.getHistoryLimitOneFailCount -= 1;
            throw new Error("timeout");
          }

          if (state.latestTelegramMessageId === null) {
            return [];
          }

          return [
            {
              id: state.latestTelegramMessageId,
            },
          ];
        }

        if (limit === 200) {
          return state.initialHistory;
        }

        return [];
      },
      getMessages: async (chatId: number, messageIds: number[]) => {
        const firstId = messageIds[0] ?? 0;
        state.getMessagesCalls.push({
          chatId,
          firstId,
          size: messageIds.length,
        });

        return state.getMessagesResponsesByFirstId.get(firstId) ?? [];
      },
      iterDialogs: (params?: { archived?: "exclude" | "keep" | "only" }) => {
        state.iterDialogsCalls.push({
          archived: params?.archived,
        });

        const dialogs = state.iterDialogsEntries;
        return (async function* () {
          for (const dialog of dialogs) {
            yield dialog;
          }
        })();
      },
      iterHistory: (_chatId: number, params?: { minId?: number }) => {
        state.iterHistoryCalls.push({
          chatId: _chatId,
          minId: params?.minId ?? 0,
        });

        const messages = state.incrementalHistory;
        return (async function* () {
          for (const message of messages) {
            yield message;
          }
        })();
      },
      start: async () => ({ id: state.startedAccountId }),
    },
    config,
    sessionPath: "/tmp/userbot/mtcute-primary.sqlite",
  };
}

describe("sync:once command", () => {
  test("fails fast when session file is missing", async () => {
    let createClientCalls = 0;
    const statusCode = await runSyncOnceCli({
      createClient: async () => {
        createClientCalls += 1;
        return createFakeBundle(createFakeState());
      },
      createDb: () => createFakeDb(createFakeState()),
      hasFile: async () => false,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(statusCode).toBe(1);
    expect(createClientCalls).toBe(0);
  });

  test("bot mode can start sync without a pre-existing session file", async () => {
    const state = createFakeState();
    let receivedBotToken = "";
    const baseBundle = createFakeBundle(state);

    const result = await runSyncOnce(
      {
        createClient: async () => ({
          config: baseBundle.config,
          sessionPath: baseBundle.sessionPath,
          client: {
            ...(baseBundle.client as any),
            start: async (params?: { botToken?: string }) => {
              receivedBotToken = params?.botToken ?? "";
              return { id: 1 };
            },
          } as any,
        }),
        createDb: () => createFakeDb(state),
        hasFile: async () => false,
        loadConfig: () => ({
          ...createConfig(),
          authMode: "bot",
          botToken: "bot-token-999",
        }),
        loadDatabaseUrl: () => "postgres://db",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      { parserTypes: ["bot", "userbot"] }
    );

    expect(receivedBotToken).toBe("bot-token-999");
  });

  test("imports missing eligible userbot communities as inactive records", async () => {
    const state = createFakeState({
      iterDialogsEntries: [
        {
          peer: {
            chatType: "group",
            id: -1000000000101,
            isMember: true,
            title: "Group One",
            type: "chat",
          },
        },
        {
          peer: {
            chatType: "supergroup",
            id: -1000000000102,
            isMember: true,
            title: "Super One",
            type: "chat",
          },
        },
        {
          peer: {
            chatType: "group",
            id: -1000000000101,
            isMember: true,
            title: "Group One Duplicate",
            type: "chat",
          },
        },
        {
          peer: {
            id: 123456,
            type: "user",
          },
        },
        {
          peer: {
            chatType: "group",
            id: -1000000000103,
            isMember: false,
            title: "Left Group",
            type: "chat",
          },
        },
        {
          peer: {
            chatType: "channel",
            id: -1000000000104,
            isMember: true,
            title: "Channel",
            type: "chat",
          },
        },
      ],
      startedAccountId: BigInt(777000),
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.missingUserbotCommunitiesInserted).toBe(2);
    expect(state.iterDialogsCalls).toEqual([{ archived: "exclude" }]);
    expect(state.insertedCommunityRows.map((row) => row.chatId)).toEqual([
      BigInt(-1000000000101),
      BigInt(-1000000000102),
    ]);
    expect(
      state.insertedCommunityRows.every(
        (row) =>
          row.activatedBy === BigInt(777000) &&
          row.isActive === false &&
          row.isPublic === false &&
          row.parserType === "userbot"
      )
    ).toBe(true);
  });

  test("dialog-sync-only mode imports missing communities and skips message sync", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000001101),
          chatTitle: "Active Community",
          id: "community-active",
          parserType: "userbot",
        },
      ],
      iterDialogsEntries: [
        {
          peer: {
            chatType: "group",
            id: -1000000001102,
            isMember: true,
            title: "Discovery Only Group",
            type: "chat",
          },
        },
      ],
      latestStoredMessageId: BigInt(10),
      latestTelegramMessageId: 11,
    });

    const result = await runSyncOnce(
      {
        createClient: async () => createFakeBundle(state),
        createDb: () => createFakeDb(state),
        hasFile: async () => true,
        loadConfig: () => createConfig(),
        loadDatabaseUrl: () => "postgres://db",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      { dialogSyncOnly: true }
    );

    expect(result.stats.missingUserbotCommunitiesInserted).toBe(1);
    expect(state.getHistoryCalls).toEqual([]);
    expect(state.iterHistoryCalls).toEqual([]);
    expect(state.getMessagesCalls).toEqual([]);
    expect(state.insertedCommunityRows[0]?.chatId).toBe(BigInt(-1000000001102));
    expect(state.insertedCommunityRows[0]?.isActive).toBe(false);
    expect(state.insertedCommunityRows[0]?.isPublic).toBe(false);
  });

  test("dialog-sync-only mode in bot auth remains a no-op and skips message sync", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000001201),
          chatTitle: "Bot Community",
          id: "community-bot",
          parserType: "bot",
        },
      ],
      latestStoredMessageId: BigInt(50),
      getMessagesResponsesByFirstId: new Map<number, Array<unknown | null>>([
        [51, [{ id: 51 }]],
      ]),
    });
    const botConfig: UserbotConfig = {
      ...createConfig(),
      authMode: "bot",
      botToken: "bot-token-999",
    };

    const result = await runSyncOnce(
      {
        createClient: async () => createFakeBundle(state, botConfig),
        createDb: () => createFakeDb(state),
        hasFile: async () => true,
        loadConfig: () => botConfig,
        loadDatabaseUrl: () => "postgres://db",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      { dialogSyncOnly: true, parserTypes: ["bot", "userbot"] }
    );

    expect(result.stats.communitiesProcessed).toBe(0);
    expect(state.iterDialogsCalls).toEqual([]);
    expect(state.getMessagesCalls).toEqual([]);
    expect(state.getHistoryCalls).toEqual([]);
  });

  test("does not insert discovered community when it already exists in database", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000201),
          chatTitle: "Existing Bot Community",
          id: "community-bot-existing",
          parserType: "bot",
        },
      ],
      iterDialogsEntries: [
        {
          peer: {
            chatType: "group",
            id: -1000000000201,
            isMember: true,
            title: "Existing Bot Community",
            type: "chat",
          },
        },
      ],
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.missingUserbotCommunitiesDetected).toBe(0);
    expect(result.stats.missingUserbotCommunitiesInserted).toBe(0);
    expect(state.insertedCommunityRows).toHaveLength(0);
  });

  test("skips non-member or non-group dialogs during community discovery", async () => {
    const state = createFakeState({
      iterDialogsEntries: [
        {
          peer: {
            chatType: "channel",
            id: -1000000000301,
            isMember: true,
            type: "chat",
          },
        },
        {
          peer: {
            chatType: "group",
            id: -1000000000302,
            isMember: false,
            type: "chat",
          },
        },
        { peer: { id: 555, type: "user" } },
      ],
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.telegramDialogsScanned).toBe(3);
    expect(result.stats.telegramEligibleGroupDialogs).toBe(0);
    expect(result.stats.missingUserbotCommunitiesDetected).toBe(0);
    expect(result.stats.missingUserbotCommunitiesInserted).toBe(0);
    expect(state.insertedCommunityRows).toHaveLength(0);
  });

  test("bot mode uses getMessages id batches and avoids getHistory", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000099),
          chatTitle: "Bot Community",
          id: "community-bot",
          parserType: "bot",
        },
      ],
      latestStoredMessageId: BigInt(500),
      getMessagesResponsesByFirstId: new Map<number, Array<unknown | null>>([
        [
          501,
          [
            {
              date: new Date("2026-03-01T12:00:00.000Z"),
              id: 501,
              isService: false,
              media: null,
              sender: {
                displayName: "Bob",
                id: 2,
                type: "user",
                username: "bob",
              },
              text: "message 1",
            } satisfies MessageRecord,
            {
              date: new Date("2026-03-01T12:01:00.000Z"),
              id: 502,
              isService: false,
              media: null,
              sender: {
                displayName: "Bob",
                id: 2,
                type: "user",
                username: "bob",
              },
              text: "message 2",
            } satisfies MessageRecord,
          ],
        ],
        [701, []],
      ]),
    });
    const botConfig: UserbotConfig = {
      ...createConfig(),
      authMode: "bot",
      botToken: "bot-token-999",
    };

    const result = await runSyncOnce(
      {
        createClient: async () => createFakeBundle(state, botConfig),
        createDb: () => createFakeDb(state),
        hasFile: async () => true,
        loadConfig: () => botConfig,
        loadDatabaseUrl: () => "postgres://db",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      { parserTypes: ["bot", "userbot"] }
    );

    expect(result.stats.authMode).toBe("bot");
    expect(result.stats.botUsedIdBatchFetch).toBe(true);
    expect(result.stats.botBatchRequests).toBe(2);
    expect(result.stats.insertedMessages).toBe(2);
    expect(state.getHistoryCalls).toEqual([]);
    expect(state.iterDialogsCalls).toEqual([]);
    expect(state.getMessagesCalls.map((call) => call.firstId)).toEqual([
      501, 701,
    ]);
  });

  test("filters out bot communities from userbot sync selection", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000009),
          chatTitle: "Bot Community",
          id: "community-bot",
          parserType: "bot",
        },
      ],
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.communitiesProcessed).toBe(0);
    expect(result.stats.insertedMessages).toBe(0);
  });

  test("includes bot communities when parser types include bot", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000011),
          chatTitle: "Bot Community",
          id: "community-bot",
          parserType: "bot",
        },
      ],
      latestStoredMessageId: BigInt(4),
      latestTelegramMessageId: 4,
    });

    const result = await runSyncOnce(
      {
        createClient: async () => createFakeBundle(state),
        createDb: () => createFakeDb(state),
        hasFile: async () => true,
        loadConfig: () => createConfig(),
        loadDatabaseUrl: () => "postgres://db",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      { parserTypes: ["bot", "userbot"] }
    );

    expect(result.stats.communitiesScanned).toBe(1);
    expect(result.stats.communitiesProcessed).toBe(1);
    expect(result.stats.selectedParserTypes).toEqual(["bot", "userbot"]);
  });

  test("filters communities by explicit chat ids when provided", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000012),
          chatTitle: "Keep",
          id: "community-keep",
          parserType: "userbot",
        },
        {
          chatId: BigInt(-1000000000013),
          chatTitle: "Skip",
          id: "community-skip",
          parserType: "userbot",
        },
      ],
      latestStoredMessageId: BigInt(4),
      latestTelegramMessageId: 4,
    });

    const result = await runSyncOnce(
      {
        createClient: async () => createFakeBundle(state),
        createDb: () => createFakeDb(state),
        hasFile: async () => true,
        loadConfig: () => createConfig(),
        loadDatabaseUrl: () => "postgres://db",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      { chatIds: [BigInt(-1000000000012)] }
    );

    expect(result.stats.communitiesScanned).toBe(1);
    expect(result.stats.communitiesProcessed).toBe(1);
    expect(state.getHistoryCalls).toEqual([
      {
        chatId: Number(BigInt(-1000000000012)),
        limit: 1,
      },
    ]);
  });

  test("skips insertion when no new Telegram messages are available", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000001),
          chatTitle: "Community",
          id: "community-1",
          parserType: "userbot",
        },
      ],
      latestStoredMessageId: BigInt(42),
      latestTelegramMessageId: 42,
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.communitiesUpToDate).toBe(1);
    expect(result.stats.insertedMessages).toBe(0);
    expect(result.stats.telegramMessagesFetched).toBe(0);
    expect(state.getHistoryCalls).toEqual([
      {
        chatId: Number(BigInt(-1000000000001)),
        limit: 1,
      },
    ]);
  });

  test("inserts unseen text messages from initial backfill", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000002),
          chatTitle: "Community",
          id: "community-1",
          parserType: "userbot",
        },
      ],
      initialHistory: [
        {
          date: new Date("2026-01-01T00:00:00.000Z"),
          id: 3,
          isService: true,
          media: null,
          sender: {
            displayName: "Alice",
            id: 1,
            type: "user",
            username: "alice",
          },
          text: "service",
        } satisfies MessageRecord,
        {
          date: new Date("2026-01-01T00:01:00.000Z"),
          id: 4,
          isService: false,
          media: null,
          sender: {
            displayName: "Alice",
            id: 1,
            type: "user",
            username: "alice",
          },
          text: "hello",
        } satisfies MessageRecord,
        {
          date: new Date("2026-01-01T00:02:00.000Z"),
          id: 5,
          isService: false,
          media: { type: "webpage" },
          sender: {
            displayName: "Alice",
            id: 1,
            type: "user",
            username: "alice",
          },
          text: "link preview message",
        } satisfies MessageRecord,
      ],
      latestStoredMessageId: null,
      latestTelegramMessageId: 5,
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.communitiesWithNoStoredMessages).toBe(1);
    expect(result.stats.telegramMessagesFetched).toBe(3);
    expect(result.stats.skippedNonText).toBe(1);
    expect(result.stats.insertedUsers).toBe(1);
    expect(result.stats.insertedMemberships).toBe(1);
    expect(result.stats.insertedMessages).toBe(2);
    expect(state.getHistoryCalls).toEqual([
      {
        chatId: Number(BigInt(-1000000000002)),
        limit: 1,
      },
      {
        chatId: Number(BigInt(-1000000000002)),
        limit: 200,
      },
    ]);
  });

  test("tracks unsupported raw message shapes explicitly", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000005),
          chatTitle: "Community",
          id: "community-1",
          parserType: "userbot",
        },
      ],
      latestStoredMessageId: null,
      latestTelegramMessageId: 5,
      initialHistory: [
        { bad: "shape" },
        {
          date: new Date("2026-01-01T00:01:00.000Z"),
          id: 4,
          isService: false,
          media: null,
          sender: {
            displayName: "Alice",
            id: 1,
            type: "user",
            username: "alice",
          },
          text: "hello",
        } satisfies MessageRecord,
      ],
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.skippedUnsupportedShape).toBe(1);
    expect(result.stats.insertedMessages).toBe(1);
  });

  test("does not double-insert with overlap between stored and fetched history", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000003),
          chatTitle: "Community",
          id: "community-1",
          parserType: "userbot",
        },
      ],
      incrementalHistory: [
        {
          date: new Date("2026-01-02T00:00:00.000Z"),
          id: 10,
          isService: false,
          media: null,
          sender: { displayName: "Bob", id: 2, type: "user", username: "bob" },
          text: "already saved",
        } satisfies MessageRecord,
        {
          date: new Date("2026-01-02T00:01:00.000Z"),
          id: 11,
          isService: false,
          media: null,
          sender: { displayName: "Bob", id: 2, type: "user", username: "bob" },
          text: "duplicate overlap",
        } satisfies MessageRecord,
        {
          date: new Date("2026-01-02T00:02:00.000Z"),
          id: 12,
          isService: false,
          media: null,
          sender: { displayName: "Bob", id: 2, type: "user", username: "bob" },
          text: "fresh message",
        } satisfies MessageRecord,
      ],
      latestStoredMessageId: BigInt(10),
      latestTelegramMessageId: 12,
    });
    state.existingMessageKeys.add("community-1:11");

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.skippedOldOrEqual).toBe(1);
    expect(result.stats.duplicateMessages).toBe(1);
    expect(result.stats.insertedMessages).toBe(1);
    expect(state.iterHistoryCalls).toEqual([
      {
        chatId: Number(BigInt(-1000000000003)),
        minId: 10,
      },
    ]);
  });

  test("retries transient Telegram failures with bounded backoff", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000010),
          chatTitle: "Community",
          id: "community-1",
          parserType: "userbot",
        },
      ],
      getHistoryLimitOneFailCount: 1,
      latestStoredMessageId: BigInt(7),
      latestTelegramMessageId: 7,
    });

    const result = await runSyncOnce({
      createClient: async () => createFakeBundle(state),
      createDb: () => createFakeDb(state),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://db",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.retryCount).toBe(1);
    expect(result.stats.communitiesFailed).toBe(0);
    expect(result.stats.communitiesUpToDate).toBe(1);
  });

  test("lookback mode in bot auth inserts only messages inside UTC recovery window", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1000000000014),
          chatTitle: "Lookback",
          id: "community-1",
          parserType: "bot",
        },
      ],
      latestStoredMessageId: BigInt(100),
      getMessagesResponsesByFirstId: new Map<number, Array<unknown | null>>([
        [
          101,
          [
            {
              date: new Date("2026-03-01T12:00:00.000Z"),
              id: 101,
              isService: false,
              media: null,
              sender: {
                displayName: "Bob",
                id: 2,
                type: "user",
                username: "bob",
              },
              text: "inside window",
            } satisfies MessageRecord,
            {
              date: new Date("2026-03-03T01:00:00.000Z"),
              id: 102,
              isService: false,
              media: null,
              sender: {
                displayName: "Bob",
                id: 2,
                type: "user",
                username: "bob",
              },
              text: "outside window end",
            } satisfies MessageRecord,
          ],
        ],
      ]),
    });
    const botConfig: UserbotConfig = {
      ...createConfig(),
      authMode: "bot",
      botToken: "bot-token-999",
    };

    const result = await runSyncOnce(
      {
        createClient: async () => createFakeBundle(state, botConfig),
        createDb: () => createFakeDb(state),
        hasFile: async () => true,
        loadConfig: () => botConfig,
        loadDatabaseUrl: () => "postgres://db",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      {
        lookbackDays: 2,
        now: new Date("2026-03-03T12:00:00.000Z"),
        parserTypes: ["bot", "userbot"],
      }
    );

    expect(result.stats.lookbackDays).toBe(2);
    expect(result.stats.lookbackWindowStartUtc).toBe(
      "2026-03-01T00:00:00.000Z"
    );
    expect(result.stats.lookbackWindowEndExclusiveUtc).toBe(
      "2026-03-03T00:00:00.000Z"
    );
    expect(result.stats.botUsedLookbackFilter).toBe(true);
    expect(result.stats.insertedMessages).toBe(1);
    expect(state.getHistoryCalls).toEqual([]);
    expect(state.iterHistoryCalls).toEqual([]);
    expect(state.getMessagesCalls[0]?.firstId).toBe(101);
  });
});
