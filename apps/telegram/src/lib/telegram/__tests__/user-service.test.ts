import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type UserRecord = {
  id: string;
  avatarUrl: string | null;
};

const findFirstCalls: unknown[] = [];
const insertCalls: unknown[] = [];
const updateCalls: unknown[] = [];
let insertReturningCallCount = 0;

let findFirstImpl: () => Promise<UserRecord | null> = async () => null;
let insertReturningImpl: () => Promise<UserRecord[]> = async () => [];
let captureImpl: (telegramId: bigint) => Promise<string | null> = async () =>
  null;
const captureCalls: bigint[] = [];

mock.module("@/lib/core/database", () => ({
  getDatabase: () => ({
    query: {
      users: {
        findFirst: async (args: unknown) => {
          findFirstCalls.push(args);
          return findFirstImpl();
        },
      },
    },
    insert: () => ({
      values: (values: unknown) => {
        insertCalls.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              insertReturningCallCount += 1;
              return insertReturningImpl();
            },
          }),
        };
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          updateCalls.push(values);
        },
      }),
    }),
  }),
}));

mock.module("@/lib/telegram/profile-photo-service", () => ({
  captureTelegramProfilePhotoToCdn: async (telegramId: bigint) => {
    captureCalls.push(telegramId);
    return captureImpl(telegramId);
  },
}));

let getOrCreateUser: typeof import("../user-service").getOrCreateUser;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("getOrCreateUser", () => {
  beforeAll(async () => {
    const loaded = await import("../user-service");
    getOrCreateUser = loaded.getOrCreateUser;
  });

  beforeEach(() => {
    findFirstCalls.length = 0;
    insertCalls.length = 0;
    updateCalls.length = 0;
    captureCalls.length = 0;
    insertReturningCallCount = 0;
    findFirstImpl = async () => null;
    insertReturningImpl = async () => [];
    captureImpl = async () => null;
  });

  test("handles insert conflict by re-querying existing user", async () => {
    const findFirstResults: Array<UserRecord | null> = [
      null,
      { id: "user-conflict", avatarUrl: null },
    ];
    findFirstImpl = async () => findFirstResults.shift() ?? null;
    insertReturningImpl = async () => [];

    const userId = await getOrCreateUser(BigInt("2001"), {
      username: "user-conflict",
      displayName: "User Conflict",
    });

    expect(userId).toBe("user-conflict");
    expect(findFirstCalls).toHaveLength(2);
    expect(insertReturningCallCount).toBe(1);
    expect(insertCalls).toHaveLength(2);
  });

  test("backfills avatar URL for newly inserted user", async () => {
    findFirstImpl = async () => null;
    insertReturningImpl = async () => [{ id: "user-new", avatarUrl: null }];
    captureImpl = async () => "https://cdn.example.com/avatar.jpg";

    const userId = await getOrCreateUser(BigInt("2002"), {
      username: "user-new",
      displayName: "User New",
    });

    expect(userId).toBe("user-new");
    expect(captureCalls).toEqual([BigInt("2002")]);
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0] as { avatarUrl?: string }).avatarUrl).toBe(
      "https://cdn.example.com/avatar.jpg"
    );
    expect(insertCalls).toHaveLength(2);
  });

  test("skips avatar capture for existing user with avatar URL", async () => {
    findFirstImpl = async () => ({
      id: "user-has-avatar",
      avatarUrl: "https://cdn.example.com/exists.jpg",
    });

    const first = await getOrCreateUser(BigInt("2003"), {
      username: "existing",
      displayName: "Existing",
    });
    const second = await getOrCreateUser(BigInt("2003"), {
      username: "existing",
      displayName: "Existing",
    });

    expect(first).toBe("user-has-avatar");
    expect(second).toBe("user-has-avatar");
    expect(findFirstCalls).toHaveLength(1);
    expect(captureCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(1);
  });

  test("deduplicates concurrent get/create requests for the same user", async () => {
    findFirstImpl = async () => null;
    insertReturningImpl = async () => {
      await sleep(20);
      return [
        { id: "user-inflight", avatarUrl: "https://cdn.example.com/a.jpg" },
      ];
    };

    const [first, second] = await Promise.all([
      getOrCreateUser(BigInt("2004"), {
        username: "inflight",
        displayName: "Inflight",
      }),
      getOrCreateUser(BigInt("2004"), {
        username: "inflight",
        displayName: "Inflight",
      }),
    ]);

    expect(first).toBe("user-inflight");
    expect(second).toBe("user-inflight");
    expect(insertReturningCallCount).toBe(1);
    expect(insertCalls).toHaveLength(2);
  });
});
