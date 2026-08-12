import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "grammy";

mock.module("server-only", () => ({}));

type InsertValues = Record<string, unknown>;

let mockDb: {
  insert: () => {
    values: (values: InsertValues) => {
      onConflictDoNothing: () => Promise<void>;
    };
  };
};

let resolveActiveBotCommunityIdImpl: (
  db: unknown,
  chatId: bigint
) => Promise<string | null>;
let getOrCreateUserImpl: (
  telegramUserId: bigint,
  input: { displayName: string; username: string | null }
) => Promise<string>;

let membershipPersistedKeys: Set<string>;
let messagePersistedKeys: Set<string>;
let failMessageInsertOnce = false;
let getOrCreateUserCalls = 0;

mock.module("@/lib/core/database", () => ({
  getDatabase: () => mockDb,
}));

mock.module("../active-community-cache", () => ({
  evictActiveCommunityCache: () => {},
  resolveActiveBotCommunityId: (db: unknown, chatId: bigint) =>
    resolveActiveBotCommunityIdImpl(db, chatId),
}));

mock.module("@/lib/telegram/user-service", () => ({
  getOrCreateUser: (
    telegramUserId: bigint,
    input: { displayName: string; username: string | null }
  ) => {
    getOrCreateUserCalls += 1;
    return getOrCreateUserImpl(telegramUserId, input);
  },
}));

let handleCommunityMessage: typeof import("../message-handlers").handleCommunityMessage;

function isMessageInsert(values: InsertValues): boolean {
  return (
    "content" in values &&
    "telegramMessageId" in values &&
    "communityId" in values &&
    "userId" in values
  );
}

function createCommunityTextMessageContext(): Context {
  return {
    chat: {
      id: -1001234567890,
      type: "supergroup",
    },
    message: {
      from: {
        first_name: "Taylor",
        id: 777,
        username: "taylor",
      },
      message_id: 1234,
      text: "hello group",
    },
    update: {
      update_id: 9001,
    },
  } as unknown as Context;
}

describe("message handlers", () => {
  beforeAll(async () => {
    const loadedModule = await import("../message-handlers");
    handleCommunityMessage = loadedModule.handleCommunityMessage;
  });

  beforeEach(() => {
    membershipPersistedKeys = new Set();
    messagePersistedKeys = new Set();
    failMessageInsertOnce = false;
    getOrCreateUserCalls = 0;
    resolveActiveBotCommunityIdImpl = async () => "community-1";
    getOrCreateUserImpl = async () => "user-1";

    mockDb = {
      insert: () => ({
        values: (values: InsertValues) => ({
          onConflictDoNothing: async () => {
            if (isMessageInsert(values)) {
              if (failMessageInsertOnce) {
                failMessageInsertOnce = false;
                throw new Error("message insert failed once");
              }

              const messageKey = `${String(values.communityId)}:${String(
                values.userId
              )}:${String(values.telegramMessageId)}`;
              if (!messagePersistedKeys.has(messageKey)) {
                messagePersistedKeys.add(messageKey);
              }
              return;
            }

            const membershipKey = `${String(values.communityId)}:${String(
              values.userId
            )}`;
            if (!membershipPersistedKeys.has(membershipKey)) {
              membershipPersistedKeys.add(membershipKey);
            }
          },
        }),
      }),
    };
  });

  test("rethrows community ingest failures with structured and stack-bearing logs", async () => {
    const context = createCommunityTextMessageContext();
    const failure = new Error("findFirst failed");
    resolveActiveBotCommunityIdImpl = async () => {
      throw failure;
    };

    const previousConsoleError = console.error;
    const consoleErrorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      consoleErrorCalls.push(args);
    };

    try {
      await expect(handleCommunityMessage(context)).rejects.toThrow(
        "findFirst failed"
      );
    } finally {
      console.error = previousConsoleError;
    }

    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]?.[0]).toBe(
      "Failed to handle community message"
    );
    expect(consoleErrorCalls[0]?.[1]).toMatchObject({
      chatId: "-1001234567890",
      errorMessage: "findFirst failed",
      errorName: "Error",
      messageId: 1234,
      telegramUserId: "777",
      updateId: 9001,
    });
    expect(consoleErrorCalls[0]?.[1]).toHaveProperty("errorStack");
    expect(consoleErrorCalls[0]?.[2]).toBe(failure);
  });

  test("remains idempotent across retry after partial insert failure", async () => {
    const context = createCommunityTextMessageContext();
    failMessageInsertOnce = true;

    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      await expect(handleCommunityMessage(context)).rejects.toThrow(
        "message insert failed once"
      );
      await expect(handleCommunityMessage(context)).resolves.toBeUndefined();
    } finally {
      console.error = previousConsoleError;
    }

    expect(membershipPersistedKeys.size).toBe(1);
    expect(messagePersistedKeys.size).toBe(1);
    expect(getOrCreateUserCalls).toBe(2);
  });
});
