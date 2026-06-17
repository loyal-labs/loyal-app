import { describe, expect, test } from "bun:test";

import { Long } from "@mtcute/core";

import {
  runSummaryPublishOnce,
  runSummaryPublishOnceCli,
} from "../commands/summary-publish-once";
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
  isActive: boolean;
  parserType: "bot" | "userbot";
  summaryNotificationsEnabled: boolean;
};

type FakeInlineResponse = {
  queryId: bigint;
  resultIds: string[];
};

type FakeState = {
  callRequests: Array<Record<string, unknown>>;
  communities: CommunityRecord[];
  destroyedCount: number;
  inlineResponsesByQuery: Map<string, Array<Error | FakeInlineResponse>>;
  resolvePeerCalls: number[];
  resolveUserCalls: string[];
  sendResponsesByResultId: Map<string, Array<Error | { ok: true }>>;
  startedCount: number;
};

function createLogger(): FakeLogger {
  return {
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

function createConfig(overrides: Partial<UserbotConfig> = {}): UserbotConfig {
  return {
    accountKey: "primary",
    apiHash: "hash",
    apiId: 123,
    authMode: "user",
    botToken: null,
    storageDir: "/tmp/userbot",
    ...overrides,
  };
}

function createFakeState(
  overrides: Partial<
    Omit<
      FakeState,
      | "callRequests"
      | "destroyedCount"
      | "inlineResponsesByQuery"
      | "resolvePeerCalls"
      | "resolveUserCalls"
      | "sendResponsesByResultId"
      | "startedCount"
    >
  > = {}
): FakeState {
  return {
    callRequests: [],
    communities: overrides.communities ?? [],
    destroyedCount: 0,
    inlineResponsesByQuery: new Map(),
    resolvePeerCalls: [],
    resolveUserCalls: [],
    sendResponsesByResultId: new Map(),
    startedCount: 0,
  };
}

function shiftQueueItem<T>(queue: T[] | undefined): T | undefined {
  if (!queue || queue.length === 0) {
    return undefined;
  }

  return queue.shift();
}

function createFakeDb(state: FakeState): any {
  return {
    query: {
      communities: {
        findMany: async () => {
          // Mimic SQL filter in command: active + userbot + notifications enabled.
          return state.communities.filter(
            (community) =>
              community.isActive &&
              community.parserType === "userbot" &&
              community.summaryNotificationsEnabled
          );
        },
      },
    },
  };
}

function createFakeBundle(state: FakeState, config: UserbotConfig): any {
  return {
    client: {
      call: async (request: Record<string, unknown>) => {
        state.callRequests.push(request);

        if (request._ === "messages.getInlineBotResults") {
          const query = String(request.query);
          const queued = shiftQueueItem(
            state.inlineResponsesByQuery.get(query)
          );
          if (queued instanceof Error) {
            throw queued;
          }

          const response = queued ?? {
            queryId: 1n,
            resultIds: [],
          };

          return {
            _: "messages.botResults",
            queryId: response.queryId,
            results: response.resultIds.map((id) => ({ id })),
          };
        }

        if (request._ === "messages.sendInlineBotResult") {
          const resultId = String(request.id);
          const queued = shiftQueueItem(
            state.sendResponsesByResultId.get(resultId)
          );
          if (queued instanceof Error) {
            throw queued;
          }

          return { _: "updates" };
        }

        throw new Error(`Unexpected RPC method: ${String(request._)}`);
      },
      destroy: async () => {
        state.destroyedCount += 1;
      },
      resolvePeer: async (chatId: number) => {
        state.resolvePeerCalls.push(chatId);
        return { _: "inputPeerMock", chatId };
      },
      resolveUser: async (username: string) => {
        state.resolveUserCalls.push(username);
        return { _: "inputUserMock", username };
      },
      start: async () => {
        state.startedCount += 1;
        return { id: 1n };
      },
    },
    config,
    sessionPath: "/tmp/userbot/mtcute-primary.sqlite",
  };
}

describe("summary-publish-once", () => {
  test("selects only eligible communities and sends first inline result", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1001),
          chatTitle: "Eligible",
          id: "community-1",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
        {
          chatId: BigInt(-1002),
          chatTitle: "Wrong parser",
          id: "community-2",
          isActive: true,
          parserType: "bot",
          summaryNotificationsEnabled: true,
        },
        {
          chatId: BigInt(-1003),
          chatTitle: "Notifications off",
          id: "community-3",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: false,
        },
        {
          chatId: BigInt(-1004),
          chatTitle: "Inactive",
          id: "community-4",
          isActive: false,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
      ],
    });
    state.inlineResponsesByQuery.set("summary:-2001", [
      {
        queryId: 77n,
        resultIds: ["latest-summary", "older-summary"],
      },
    ]);

    const result = await runSummaryPublishOnce(
      {
        createClient: async (config) => createFakeBundle(state, config),
        createDb: () => createFakeDb(state),
        createRandomId: () => Long.fromInt(999),
        env: {
          TELEGRAM_SUMMARY_INLINE_BOT_USERNAME: "@custom_inline_bot",
          TELEGRAM_SUMMARY_PEER_OVERRIDE_FROM: "-1001",
          TELEGRAM_SUMMARY_PEER_OVERRIDE_TO: "-2001",
        },
        hasFile: async () => true,
        loadConfig: () => createConfig(),
        loadDatabaseUrl: () => "postgres://example",
        logger: createLogger(),
        sleep: async () => undefined,
      },
      {}
    );

    expect(result.stats.communitiesMatched).toBe(1);
    expect(result.stats.deliverySucceeded).toBe(1);
    expect(state.resolveUserCalls).toEqual(["custom_inline_bot"]);
    expect(state.resolvePeerCalls).toEqual([-1001]);

    const getInlineCall = state.callRequests.find(
      (request) => request._ === "messages.getInlineBotResults"
    );
    expect(getInlineCall?.query).toBe("summary:-2001");

    const sendCall = state.callRequests.find(
      (request) => request._ === "messages.sendInlineBotResult"
    );
    expect(sendCall?.id).toBe("latest-summary");
    expect(String(sendCall?.queryId)).toBe("77");
  });

  test("records inline_query failure when inline returns no results", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1001),
          chatTitle: "Eligible",
          id: "community-1",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
      ],
    });
    state.inlineResponsesByQuery.set("summary:-1001", [
      {
        queryId: 88n,
        resultIds: [],
      },
    ]);

    const result = await runSummaryPublishOnce({
      createClient: async (config) => createFakeBundle(state, config),
      createDb: () => createFakeDb(state),
      env: {},
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://example",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.scope).toBe("inline_query");
    expect(result.stats.deliveryFailed).toBe(1);
    expect(
      state.callRequests.some(
        (request) => request._ === "messages.sendInlineBotResult"
      )
    ).toBe(false);
  });

  test("records inline_query and delivery failures separately while continuing", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1001),
          chatTitle: "Inline fails",
          id: "community-1",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
        {
          chatId: BigInt(-1002),
          chatTitle: "Send fails",
          id: "community-2",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
        {
          chatId: BigInt(-1003),
          chatTitle: "Success",
          id: "community-3",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
      ],
    });

    state.inlineResponsesByQuery.set("summary:-1001", [
      new Error("hard inline failure"),
    ]);
    state.inlineResponsesByQuery.set("summary:-1002", [
      {
        queryId: 100n,
        resultIds: ["result-send-fail"],
      },
    ]);
    state.inlineResponsesByQuery.set("summary:-1003", [
      {
        queryId: 101n,
        resultIds: ["result-success"],
      },
    ]);

    state.sendResponsesByResultId.set("result-send-fail", [
      new Error("hard send failure"),
    ]);

    const result = await runSummaryPublishOnce({
      createClient: async (config) => createFakeBundle(state, config),
      createDb: () => createFakeDb(state),
      env: {},
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://example",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.communitiesProcessed).toBe(3);
    expect(result.stats.deliverySucceeded).toBe(1);
    expect(result.errors.map((entry) => entry.scope)).toEqual([
      "inline_query",
      "delivery",
    ]);
  });

  test("increments retryCount for transient failures", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1001),
          chatTitle: "Retries",
          id: "community-1",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
      ],
    });

    state.inlineResponsesByQuery.set("summary:-1001", [
      new Error("NETWORK timeout"),
      {
        queryId: 202n,
        resultIds: ["retry-send"],
      },
    ]);
    state.sendResponsesByResultId.set("retry-send", [
      new Error("RPC_CALL_FAIL"),
      { ok: true },
    ]);

    const result = await runSummaryPublishOnce({
      createClient: async (config) => createFakeBundle(state, config),
      createDb: () => createFakeDb(state),
      env: {},
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://example",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(result.stats.retryCount).toBe(2);
    expect(result.stats.deliverySucceeded).toBe(1);
    expect(result.stats.errors).toBe(0);
  });

  test("fails fast in bot auth mode", async () => {
    await expect(
      runSummaryPublishOnce({
        env: {},
        loadConfig: () =>
          createConfig({
            authMode: "bot",
            botToken: "token",
          }),
        logger: createLogger(),
      })
    ).rejects.toThrow("requires user auth mode");
  });

  test("runSummaryPublishOnceCli applies --chat-ids filter", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1001),
          chatTitle: "First",
          id: "community-1",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
        {
          chatId: BigInt(-1002),
          chatTitle: "Second",
          id: "community-2",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
      ],
    });

    state.inlineResponsesByQuery.set("summary:-1001", [
      {
        queryId: 1n,
        resultIds: ["summary-1"],
      },
    ]);
    state.inlineResponsesByQuery.set("summary:-1002", [
      {
        queryId: 2n,
        resultIds: ["summary-2"],
      },
    ]);

    const originalArgv = [...process.argv];
    process.argv = [
      originalArgv[0] ?? "bun",
      originalArgv[1] ?? "summary-publish-once.ts",
      "--chat-ids=-1002",
    ];

    try {
      const exitCode = await runSummaryPublishOnceCli({
        createClient: async (config) => createFakeBundle(state, config),
        createDb: () => createFakeDb(state),
        env: {},
        hasFile: async () => true,
        loadConfig: () => createConfig(),
        loadDatabaseUrl: () => "postgres://example",
        logger: createLogger(),
        sleep: async () => undefined,
      });

      expect(exitCode).toBe(0);
      expect(state.resolvePeerCalls).toEqual([-1002]);

      const inlineQueries = state.callRequests.filter(
        (request) => request._ === "messages.getInlineBotResults"
      );
      expect(inlineQueries).toHaveLength(1);
      expect(inlineQueries[0]?.query).toBe("summary:-1002");
    } finally {
      process.argv = originalArgv;
    }
  });

  test("runSummaryPublishOnceCli returns exit code 1 when errors are present", async () => {
    const state = createFakeState({
      communities: [
        {
          chatId: BigInt(-1001),
          chatTitle: "Fails",
          id: "community-1",
          isActive: true,
          parserType: "userbot",
          summaryNotificationsEnabled: true,
        },
      ],
    });

    state.inlineResponsesByQuery.set("summary:-1001", [
      new Error("hard inline failure"),
    ]);

    const exitCode = await runSummaryPublishOnceCli({
      createClient: async (config) => createFakeBundle(state, config),
      createDb: () => createFakeDb(state),
      env: {},
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      loadDatabaseUrl: () => "postgres://example",
      logger: createLogger(),
      sleep: async () => undefined,
    });

    expect(exitCode).toBe(1);
  });
});
