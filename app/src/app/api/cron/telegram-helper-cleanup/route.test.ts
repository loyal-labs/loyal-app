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

const TEST_ENV_KEYS = ["CRON_SECRET"] as const;

type CleanupQueueRow = {
  chatId: bigint;
  createdAt: Date;
  deleteAfter: Date;
  id: string;
  messageId: number;
};

const DEFAULT_CLAIM_RESULT = [{ id: "claimed" }];

let cleanupQueueRows: CleanupQueueRow[] = [];
let claimReturningQueue: Array<Array<{ id: string }>> = [];
let deleteMessageCalls: Array<{ chatId: string; messageId: number }> = [];
let deleteQueueWhereCalls = 0;
let updateWhereCalls: Array<{ returningCalled: boolean; values: unknown }> = [];
let deleteMessageImpl: (
  chatId: string,
  messageId: number
) => Promise<void> = async (chatId, messageId) => {
  deleteMessageCalls.push({ chatId, messageId });
};

function clearTestEnv(): void {
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
}

mock.module("@/lib/core/database", () => ({
  getDatabase: () => ({
    delete: () => ({
      where: async () => {
        deleteQueueWhereCalls += 1;
      },
    }),
    query: {
      telegramHelperMessageCleanup: {
        findMany: async () => cleanupQueueRows,
      },
    },
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          const call = { returningCalled: false, values };
          updateWhereCalls.push(call);
          return {
            returning: async () => {
              call.returningCalled = true;
              return claimReturningQueue.shift() ?? DEFAULT_CLAIM_RESULT;
            },
          };
        },
      }),
    }),
  }),
}));

mock.module("@/lib/telegram/bot-api/bot", () => ({
  getBot: async () => ({
    api: {
      deleteMessage: async (chatId: string, messageId: number) =>
        deleteMessageImpl(chatId, messageId),
    },
  }),
}));

let POST: (request: Request) => Promise<Response>;

function createDueQueueRow(overrides?: Partial<CleanupQueueRow>): CleanupQueueRow {
  const now = Date.now();
  return {
    chatId: BigInt("-1001234"),
    createdAt: new Date(now - 2 * 60 * 1000),
    deleteAfter: new Date(now - 5 * 1000),
    id: "q-1",
    messageId: 11,
    ...overrides,
  };
}

describe("telegram helper cleanup cron route", () => {
  beforeAll(async () => {
    const loadedModule = await import("./route");
    POST = loadedModule.POST;
  });

  beforeEach(() => {
    clearTestEnv();
    cleanupQueueRows = [];
    claimReturningQueue = [];
    deleteMessageCalls = [];
    deleteQueueWhereCalls = 0;
    updateWhereCalls = [];
    deleteMessageImpl = async (chatId, messageId) => {
      deleteMessageCalls.push({ chatId, messageId });
    };
  });

  afterEach(() => {
    clearTestEnv();
  });

  test("returns quickly when queue is empty", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const request = new Request(
      "http://localhost/api/cron/telegram-helper-cleanup",
      {
        method: "POST",
        headers: { authorization: "Bearer expected-secret" },
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      stats: {
        claimed: 0,
        droppedExpired: 0,
        due: 0,
        queueDeleted: 0,
        retryScheduled: 0,
        skippedAlreadyClaimed: 0,
        successfulDeletes: 0,
        terminalErrors: 0,
        transientErrors: 0,
      },
    });
    expect(deleteMessageCalls).toHaveLength(0);
    expect(deleteQueueWhereCalls).toBe(0);
  });

  test("claim success then delete success removes row", async () => {
    process.env.CRON_SECRET = "expected-secret";
    cleanupQueueRows = [createDueQueueRow()];

    const request = new Request(
      "http://localhost/api/cron/telegram-helper-cleanup",
      {
        method: "POST",
        headers: { authorization: "Bearer expected-secret" },
      }
    );

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deleteMessageCalls).toEqual([{ chatId: "-1001234", messageId: 11 }]);
    expect(deleteQueueWhereCalls).toBe(1);
    expect(payload.stats).toEqual({
      claimed: 1,
      droppedExpired: 0,
      due: 1,
      queueDeleted: 1,
      retryScheduled: 0,
      skippedAlreadyClaimed: 0,
      successfulDeletes: 1,
      terminalErrors: 0,
      transientErrors: 0,
    });
  });

  test("skips candidate when claim lease is lost", async () => {
    process.env.CRON_SECRET = "expected-secret";
    cleanupQueueRows = [createDueQueueRow()];
    claimReturningQueue = [[]];

    const request = new Request(
      "http://localhost/api/cron/telegram-helper-cleanup",
      {
        method: "POST",
        headers: { authorization: "Bearer expected-secret" },
      }
    );

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deleteMessageCalls).toHaveLength(0);
    expect(deleteQueueWhereCalls).toBe(0);
    expect(payload.stats).toEqual({
      claimed: 0,
      droppedExpired: 0,
      due: 1,
      queueDeleted: 0,
      retryScheduled: 0,
      skippedAlreadyClaimed: 1,
      successfulDeletes: 0,
      terminalErrors: 0,
      transientErrors: 0,
    });
  });

  test("drops row on terminal Telegram delete errors after claim", async () => {
    process.env.CRON_SECRET = "expected-secret";
    cleanupQueueRows = [createDueQueueRow({ messageId: 22 })];
    deleteMessageImpl = async () => {
      throw {
        description: "Bad Request: message to delete not found",
        error_code: 400,
      };
    };

    const request = new Request(
      "http://localhost/api/cron/telegram-helper-cleanup",
      {
        method: "POST",
        headers: { authorization: "Bearer expected-secret" },
      }
    );

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deleteQueueWhereCalls).toBe(1);
    expect(payload.stats).toEqual({
      claimed: 1,
      droppedExpired: 0,
      due: 1,
      queueDeleted: 1,
      retryScheduled: 0,
      skippedAlreadyClaimed: 0,
      successfulDeletes: 0,
      terminalErrors: 1,
      transientErrors: 0,
    });
  });

  test("reschedules transient failures within retry window", async () => {
    process.env.CRON_SECRET = "expected-secret";
    cleanupQueueRows = [
      createDueQueueRow({
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        messageId: 33,
      }),
    ];
    deleteMessageImpl = async () => {
      throw { description: "Too Many Requests", error_code: 429 };
    };

    const request = new Request(
      "http://localhost/api/cron/telegram-helper-cleanup",
      {
        method: "POST",
        headers: { authorization: "Bearer expected-secret" },
      }
    );

    const response = await POST(request);
    const payload = await response.json();

    const rescheduleCalls = updateWhereCalls.filter(
      (call) => !call.returningCalled
    );
    expect(response.status).toBe(200);
    expect(deleteQueueWhereCalls).toBe(0);
    expect(rescheduleCalls).toHaveLength(1);
    expect(payload.stats).toEqual({
      claimed: 1,
      droppedExpired: 0,
      due: 1,
      queueDeleted: 0,
      retryScheduled: 1,
      skippedAlreadyClaimed: 0,
      successfulDeletes: 0,
      terminalErrors: 0,
      transientErrors: 1,
    });
  });

  test("drops transient failures that exceed retry window", async () => {
    process.env.CRON_SECRET = "expected-secret";
    cleanupQueueRows = [
      createDueQueueRow({
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        messageId: 44,
      }),
    ];
    deleteMessageImpl = async () => {
      throw { description: "Too Many Requests", error_code: 429 };
    };

    const request = new Request(
      "http://localhost/api/cron/telegram-helper-cleanup",
      {
        method: "POST",
        headers: { authorization: "Bearer expected-secret" },
      }
    );

    const response = await POST(request);
    const payload = await response.json();

    const rescheduleCalls = updateWhereCalls.filter(
      (call) => !call.returningCalled
    );
    expect(response.status).toBe(200);
    expect(rescheduleCalls).toHaveLength(0);
    expect(deleteQueueWhereCalls).toBe(1);
    expect(payload.stats).toEqual({
      claimed: 1,
      droppedExpired: 1,
      due: 1,
      queueDeleted: 1,
      retryScheduled: 0,
      skippedAlreadyClaimed: 0,
      successfulDeletes: 0,
      terminalErrors: 0,
      transientErrors: 1,
    });
  });
});
