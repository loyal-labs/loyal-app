import { afterEach, describe, expect, test } from "bun:test";

import { runEarnRealtimeLifecycle } from "./lifecycle";
import {
  consumeEarnRealtimeStream,
  EarnRealtimeHttpError,
  EarnRealtimeSilenceError,
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

  test("surfaces stream authorization failures with their status", async () => {
    for (const status of [401, 403]) {
      globalThis.fetch = (async () =>
        new Response(null, { status })) as unknown as typeof fetch;

      await expect(
        consumeEarnRealtimeStream({
          cursor: "10",
          onConnected: () => undefined,
          onInvalidation: () => undefined,
          response: token,
          signal: new AbortController().signal,
        })
      ).rejects.toMatchObject({
        name: "EarnRealtimeHttpError",
        phase: "stream",
        status,
      });
    }
  });

  test("treats heartbeat bytes as activity and rejects a silent stream", async () => {
    let sourceCanceled = false;
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            sourceCanceled = true;
          },
          start(controller) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          },
        }),
        {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        }
      );
    }) as unknown as typeof fetch;
    const scheduled: Array<{ callback: () => void; canceled: boolean }> = [];
    const running = consumeEarnRealtimeStream({
      cursor: null,
      onConnected: () => undefined,
      onInvalidation: () => undefined,
      response: token,
      scheduleSilenceTimeout: (callback) => {
        const entry = { callback, canceled: false };
        scheduled.push(entry);
        return () => {
          entry.canceled = true;
        };
      },
      signal: new AbortController().signal,
    });

    for (let attempt = 0; attempt < 20 && scheduled.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(scheduled.length).toBe(2);
    expect(scheduled[0]?.canceled).toBe(true);
    scheduled[1]?.callback();

    await expect(running).rejects.toBeInstanceOf(EarnRealtimeSilenceError);
    expect(sourceCanceled).toBe(true);
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
      onCursorlessConnected: () => undefined,
      onInvalidation: () => undefined,
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

  test("clears a stale cursor, reconnects, then reconciles canonical state", async () => {
    const lifecycle = new AbortController();
    const order: string[] = [];
    let cursor: string | null = "41";
    let streamCount = 0;
    const canonicalRefreshStarted = deferred();
    const canonicalRefreshCompleted = deferred();
    const reconciledConnectionReported = deferred();

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
        await reconciledConnectionReported.promise;
        lifecycle.abort();
        return { reason: "closed" };
      },
      getCursor: () => cursor,
      onConnected: () => {
        order.push("connected");
        if (streamCount === 2) reconciledConnectionReported.resolve();
      },
      onConnecting: () => undefined,
      onCursorlessConnected: async () => {
        order.push("canonical-refresh-started");
        canonicalRefreshStarted.resolve();
        await canonicalRefreshCompleted.promise;
        order.push("canonical-refresh-completed");
      },
      onInvalidation: () => undefined,
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
    expect(streamCount).toBe(2);
    expect(order).toEqual([
      "stream:41",
      "connected",
      "cursor-cleared",
      "stream:empty",
      "canonical-refresh-started",
    ]);

    canonicalRefreshCompleted.resolve();
    await running;
    expect(order).toEqual([
      "stream:41",
      "connected",
      "cursor-cleared",
      "stream:empty",
      "canonical-refresh-started",
      "canonical-refresh-completed",
      "connected",
    ]);
  });

  test("does not report a cursorless connection until reconciliation succeeds", async () => {
    const lifecycle = new AbortController();
    const order: string[] = [];
    const secondReconciliationStarted = deferred();
    const allowSecondReconciliation = deferred();
    const admitted = deferred();
    let reconciliationAttempt = 0;
    let streamCount = 0;

    const running = runEarnRealtimeLifecycle({
      clearCursor: () => order.push("cursor-cleared"),
      consumeStream: async ({ onConnected, signal }) => {
        streamCount += 1;
        order.push(`stream:${streamCount}`);
        onConnected();
        return await new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      },
      getCursor: () => null,
      onConnected: () => {
        order.push("connected");
        admitted.resolve();
      },
      onConnecting: () => undefined,
      onCursorlessConnected: async () => {
        reconciliationAttempt += 1;
        order.push(`reconcile:${reconciliationAttempt}:started`);
        if (reconciliationAttempt === 1) {
          throw new Error("canonical refresh unavailable");
        }
        secondReconciliationStarted.resolve();
        await allowSecondReconciliation.promise;
        order.push("reconcile:2:completed");
      },
      onError: (error) => {
        order.push(
          error instanceof Error ? `error:${error.message}` : "error:unknown"
        );
      },
      onInvalidation: () => undefined,
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => undefined,
        get: async () => token,
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async (attempt) => {
        order.push(`wait:${attempt}`);
      },
    });

    await secondReconciliationStarted.promise;
    expect(streamCount).toBe(2);
    expect(order).toEqual([
      "stream:1",
      "reconcile:1:started",
      "error:canonical refresh unavailable",
      "wait:0",
      "stream:2",
      "reconcile:2:started",
    ]);

    allowSecondReconciliation.resolve();
    await admitted.promise;
    lifecycle.abort();
    await running;

    expect(order).toEqual([
      "stream:1",
      "reconcile:1:started",
      "error:canonical refresh unavailable",
      "wait:0",
      "stream:2",
      "reconcile:2:started",
      "reconcile:2:completed",
      "connected",
    ]);
  });

  test("backs off repeated cursorless admission failures until one is admitted", async () => {
    const lifecycle = new AbortController();
    const admitted = deferred();
    const waits: number[] = [];
    let reconciliationAttempt = 0;

    await runEarnRealtimeLifecycle({
      clearCursor: () => undefined,
      consumeStream: async ({ onConnected, signal }) => {
        onConnected();
        return await Promise.race([
          admitted.promise.then(() => ({ reason: "closed" as const })),
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
          }),
        ]);
      },
      getCursor: () => null,
      onConnected: () => admitted.resolve(),
      onConnecting: () => undefined,
      onCursorlessConnected: () => {
        reconciliationAttempt += 1;
        if (reconciliationAttempt <= 3) {
          throw new Error("canonical refresh unavailable");
        }
      },
      onInvalidation: () => undefined,
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => undefined,
        get: async () => token,
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async (attempt) => {
        waits.push(attempt);
        if (waits.length === 4) lifecycle.abort();
      },
    });

    expect(reconciliationAttempt).toBe(4);
    expect(waits).toEqual([0, 1, 2, 0]);
  });

  test("does not admit a cursorless stream that closes during reconciliation", async () => {
    const lifecycle = new AbortController();
    const reconciliationStarted = deferred();
    const reconciliationCompleted = deferred();
    let connectedCount = 0;
    let streamCount = 0;

    const running = runEarnRealtimeLifecycle({
      clearCursor: () => undefined,
      consumeStream: async ({ onConnected }) => {
        streamCount += 1;
        onConnected();
        return { reason: "closed" };
      },
      getCursor: () => null,
      onConnected: () => {
        connectedCount += 1;
      },
      onConnecting: () => undefined,
      onCursorlessConnected: async () => {
        reconciliationStarted.resolve();
        await reconciliationCompleted.promise;
      },
      onInvalidation: () => undefined,
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => undefined,
        get: async () => token,
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async () => {
        lifecycle.abort();
      },
    });

    await reconciliationStarted.promise;
    expect(streamCount).toBe(1);
    expect(connectedCount).toBe(0);
    reconciliationCompleted.resolve();
    await running;
    expect(connectedCount).toBe(0);
  });

  test("reports reconnecting before backoff after a healthy stream closes", async () => {
    const lifecycle = new AbortController();
    const order: string[] = [];

    await runEarnRealtimeLifecycle({
      clearCursor: () => undefined,
      consumeStream: async ({ onConnected }) => {
        onConnected();
        return { reason: "closed" };
      },
      getCursor: () => "52",
      onConnected: () => order.push("connected"),
      onConnecting: (isReconnect) =>
        order.push(isReconnect ? "reconnecting" : "connecting"),
      onCursorlessConnected: () => undefined,
      onInvalidation: () => undefined,
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => undefined,
        get: async () => token,
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async () => {
        order.push("wait");
        lifecycle.abort();
      },
    });

    expect(order).toEqual(["connecting", "connected", "reconnecting", "wait"]);
  });

  test("clears a rejected stream token before bounded reconnect", async () => {
    const lifecycle = new AbortController();
    const order: string[] = [];
    let streamCount = 0;

    await runEarnRealtimeLifecycle({
      clearCursor: () => undefined,
      consumeStream: async ({ onConnected }) => {
        streamCount += 1;
        order.push(`stream:${streamCount}`);
        if (streamCount === 1) {
          throw new EarnRealtimeHttpError("rejected", 401, "stream");
        }
        onConnected();
        lifecycle.abort();
        return { reason: "closed" };
      },
      getCursor: () => "10",
      onConnected: () => undefined,
      onConnecting: () => undefined,
      onCursorlessConnected: () => undefined,
      onInvalidation: () => undefined,
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => order.push("token-cleared"),
        get: async () => {
          order.push("token-requested");
          return token;
        },
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async (attempt) => {
        order.push(`wait:${attempt}`);
      },
    });

    expect(order).toEqual([
      "token-requested",
      "stream:1",
      "token-cleared",
      "wait:0",
      "token-requested",
      "stream:2",
      "token-cleared",
    ]);
  });

  test("keeps a still-valid token across an ordinary stream failure", async () => {
    const lifecycle = new AbortController();
    const order: string[] = [];
    let streamCount = 0;

    await runEarnRealtimeLifecycle({
      clearCursor: () => undefined,
      consumeStream: async ({ onConnected }) => {
        streamCount += 1;
        order.push(`stream:${streamCount}`);
        if (streamCount === 1) {
          throw new EarnRealtimeHttpError(
            "upstream unavailable",
            503,
            "stream"
          );
        }
        onConnected();
        lifecycle.abort();
        return { reason: "closed" };
      },
      getCursor: () => "10",
      onConnected: () => undefined,
      onConnecting: () => undefined,
      onCursorlessConnected: () => undefined,
      onInvalidation: () => undefined,
      scheduleRenewal: () => () => undefined,
      signal: lifecycle.signal,
      tokenCache: {
        clear: () => order.push("token-cleared"),
        get: async () => {
          order.push("token-requested");
          return token;
        },
        renewalDelayMs: () => 60_000,
      },
      waitForReconnect: async () => {
        order.push("wait");
      },
    });

    expect(order).toEqual([
      "token-requested",
      "stream:1",
      "wait",
      "token-requested",
      "stream:2",
      "token-cleared",
    ]);
  });
});
