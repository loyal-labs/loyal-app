import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

const initCalls: string[] = [];
const trackCalls: Array<{
  eventName: string;
  properties: Record<string, unknown>;
}> = [];
const peopleSetCalls: Array<{
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];
const peopleSetOnceCalls: Array<{
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];
const peopleUnionCalls: Array<{
  distinctId: string;
  properties: Record<string, unknown>;
}> = [];

mock.module("mixpanel", () => ({
  default: {
    init: (token: string) => {
      initCalls.push(token);
      return {
        track: (
          eventName: string,
          properties: Record<string, unknown>,
          callback?: (error?: unknown) => void
        ) => {
          trackCalls.push({ eventName, properties });
          callback?.();
        },
        people: {
          set: (
            distinctId: string,
            properties: Record<string, unknown>,
            callback?: (error?: unknown) => void
          ) => {
            peopleSetCalls.push({ distinctId, properties });
            callback?.();
          },
          set_once: (
            distinctId: string,
            properties: Record<string, unknown>,
            callback?: (error?: unknown) => void
          ) => {
            peopleSetOnceCalls.push({ distinctId, properties });
            callback?.();
          },
          union: (
            distinctId: string,
            properties: Record<string, unknown>,
            callback?: (error?: unknown) => void
          ) => {
            peopleUnionCalls.push({ distinctId, properties });
            callback?.();
          },
        },
      };
    },
  },
}));

let analyticsServer: typeof import("../analytics-server");

describe("shared server analytics client", () => {
  beforeAll(async () => {
    analyticsServer = await import("../analytics-server");
  });

  beforeEach(() => {
    initCalls.length = 0;
    trackCalls.length = 0;
    peopleSetCalls.length = 0;
    peopleSetOnceCalls.length = 0;
    peopleUnionCalls.length = 0;
    analyticsServer.__resetServerAnalyticsClientsForTests();
  });

  test("stamps workspace on every tracked event and caches the sdk client", () => {
    const client = analyticsServer.createMixpanelServerClient({
      token: "server-token",
      workspace: "website",
    });

    client.track("chat_thread_created", {
      distinct_id: "wallet:user-1",
      chat_id: "chat-123",
    });
    client.track("chat_thread_created", {
      distinct_id: "wallet:user-1",
      chat_id: "chat-456",
    });

    expect(initCalls).toEqual(["server-token"]);
    expect(trackCalls).toEqual([
      {
        eventName: "chat_thread_created",
        properties: {
          workspace: "website",
          distinct_id: "wallet:user-1",
          chat_id: "chat-123",
        },
      },
      {
        eventName: "chat_thread_created",
        properties: {
          workspace: "website",
          distinct_id: "wallet:user-1",
          chat_id: "chat-456",
        },
      },
    ]);
  });

  test("updates workspace adoption profile fields", () => {
    const client = analyticsServer.createMixpanelServerClient({
      token: "server-token",
      workspace: "bot",
    });
    const occurredAt = new Date("2026-03-26T12:00:00.000Z");

    client.updateWorkspaceProfile("tg:123", occurredAt);

    expect(peopleUnionCalls).toEqual([
      {
        distinctId: "tg:123",
        properties: {
          workspaces: ["bot"],
        },
      },
    ]);
    expect(peopleSetOnceCalls).toEqual([
      {
        distinctId: "tg:123",
        properties: {
          first_workspace: "bot",
          bot_first_seen_at: "2026-03-26T12:00:00.000Z",
        },
      },
    ]);
    expect(peopleSetCalls).toEqual([
      {
        distinctId: "tg:123",
        properties: {
          last_workspace: "bot",
          bot_last_seen_at: "2026-03-26T12:00:00.000Z",
        },
      },
    ]);
  });
});
