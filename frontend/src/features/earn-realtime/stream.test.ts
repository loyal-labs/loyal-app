import { afterEach, describe, expect, test } from "bun:test";

import { runEarnRealtimeLifecycle } from "./lifecycle";
import {
  consumeEarnRealtimeStream,
  EarnRealtimeTokenCache,
  SseFrameParser,
  type EarnRealtimeTokenResponse,
} from "./stream";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    }
  );
}

function deferred() {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const token: EarnRealtimeTokenResponse = {
  accessToken: "opaque-test-token",
  eventsUrl: "https://realtime.test/events",
  expiresAt: "2026-07-14T00:04:00.000Z",
  schemaVersion: 1,
};

describe("Earn realtime stream protocol", () => {
  test("parses chunk-split frames and multiline data", () => {
    const parser = new SseFrameParser();

    expect(parser.push("id: 10\nevent: loyal_yield\nda")).toEqual([]);
    expect(parser.push('ta: {"hello":\ndata: "world"}\n\n')).toEqual([
      {
        data: '{"hello":\n"world"}',
        event: "loyal_yield",
        id: "10",
      },
    ]);
  });

  test("reuses one memory token until its renewal window or reset", async () => {
    let tokenRequestCount = 0;
    let now = new Date("2026-07-14T00:00:00.000Z").getTime();
    globalThis.fetch = (async (input, init) => {
      void input;
      void init;
      tokenRequestCount += 1;
      return Response.json(token);
    }) as typeof fetch;
    const cache = new EarnRealtimeTokenCache(30_000, () => now);

    const first = await cache.get(new AbortController().signal);
    const reconnect = await cache.get(new AbortController().signal);

    expect(reconnect).toBe(first);
    expect(tokenRequestCount).toBe(1);

    now = new Date("2026-07-14T00:03:31.000Z").getTime();
    await cache.get(new AbortController().signal);
    expect(tokenRequestCount).toBe(2);

    cache.clear();
    await cache.get(new AbortController().signal);
    expect(tokenRequestCount).toBe(3);
  });

  test("uses bearer replay, dedupes event IDs, and requests canonical resync", async () => {
    const requestHeaders = new Headers();
    globalThis.fetch = (async (_input, init) => {
      const receivedHeaders = new Headers(init?.headers);
      receivedHeaders.forEach((value, key) => requestHeaders.set(key, value));
      return streamResponse([
        'id: 11\nevent: loyal_yield\ndata: {"schemaVersion":1,"eventId":"11","eventType":"earn.position.changed","occurredAt":"2026-07-14T00:00:00Z","scope":"earn"}\n\n',
        'id: 11\nevent: loyal_yield\ndata: {"schemaVersion":1,"eventId":"11","eventType":"earn.position.changed","occurredAt":"2026-07-14T00:00:00Z","scope":"earn"}\n\n',
        'event: loyal_yield\ndata: {"schemaVersion":1,"eventType":"resync_required","reason":"cursor_expired"}\n\n',
      ]);
    }) as typeof fetch;
    const received: string[] = [];

    const result = await consumeEarnRealtimeStream({
      cursor: "10",
      onConnected: () => undefined,
      onInvalidation: (event) => received.push(event.eventId),
      response: token,
      signal: new AbortController().signal,
    });

    expect(requestHeaders.get("authorization")).toBe(
      "Bearer opaque-test-token"
    );
    expect(requestHeaders.get("last-event-id")).toBe("10");
    expect(received).toEqual(["11"]);
    expect(result).toEqual({
      detail: "cursor_expired",
      reason: "resync_required",
    });
  });

  test("aborts the active stream when its identity lifecycle ends", async () => {
    const lifecycle = new AbortController();
    let wasActiveStreamAborted = false;
    let resolveStreamStarted: (() => void) | null = null;
    const streamStarted = new Promise<void>((resolve) => {
      resolveStreamStarted = resolve;
    });
    let tokenClearCount = 0;

    const running = runEarnRealtimeLifecycle({
      clearCursor: () => undefined,
      consumeStream: async ({ signal }) => {
        resolveStreamStarted?.();
        return await new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              wasActiveStreamAborted = signal.aborted;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true }
          );
        });
      },
      getCursor: () => "10",
      onConnected: () => undefined,
      onConnecting: () => undefined,
      onInvalidation: () => undefined,
      onResyncRequired: () => undefined,
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => {
          tokenClearCount += 1;
        },
        get: async () => token,
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async () => undefined,
    });

    await streamStarted;
    lifecycle.abort();
    await running;

    expect(wasActiveStreamAborted).toBe(true);
    expect(tokenClearCount).toBe(1);
  });

  test("clears a stale cursor and refreshes canonical state before reconnecting", async () => {
    const lifecycle = new AbortController();
    const order: string[] = [];
    let cursor: string | null = "41";
    let streamCount = 0;
    const canonicalRefreshStarted = deferred();
    const canonicalRefreshCompleted = deferred();

    const running = runEarnRealtimeLifecycle({
      clearCursor: () => {
        order.push("cursor-cleared");
        cursor = null;
      },
      consumeStream: async ({ cursor: receivedCursor, onConnected }) => {
        streamCount += 1;
        order.push(`stream:${receivedCursor ?? "empty"}`);
        onConnected();
        if (streamCount === 1) {
          return { detail: "cursor_expired", reason: "resync_required" };
        }
        lifecycle.abort();
        return { reason: "closed" };
      },
      getCursor: () => cursor,
      onConnected: () => undefined,
      onConnecting: () => undefined,
      onInvalidation: () => undefined,
      onResyncRequired: async () => {
        order.push("canonical-refresh-started");
        canonicalRefreshStarted.resolve();
        await canonicalRefreshCompleted.promise;
        order.push("canonical-refresh-completed");
      },
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => undefined,
        get: async () => token,
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async () => undefined,
    });

    await canonicalRefreshStarted.promise;
    expect(streamCount).toBe(1);
    expect(order).toEqual([
      "stream:41",
      "cursor-cleared",
      "canonical-refresh-started",
    ]);

    canonicalRefreshCompleted.resolve();
    await running;
    expect(order).toEqual([
      "stream:41",
      "cursor-cleared",
      "canonical-refresh-started",
      "canonical-refresh-completed",
      "stream:empty",
    ]);
  });
});
