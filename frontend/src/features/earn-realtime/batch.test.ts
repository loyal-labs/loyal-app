import { describe, expect, test } from "bun:test";

import {
  acceptEarnRealtimeInvalidationBatch,
  EarnRealtimeInvalidationBatcher,
} from "./batch";
import { EARN_REALTIME_EVENT_TYPES } from "./types";
import type { EarnRealtimeInvalidation } from "./types";

function event(
  eventId: string,
  eventType: string = EARN_REALTIME_EVENT_TYPES.position
): EarnRealtimeInvalidation {
  return {
    eventId,
    eventType,
    occurredAt: "2026-07-14T00:00:00Z",
    schemaVersion: 1,
    scope: "earn",
  };
}

function deferred() {
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

describe("Earn realtime invalidation acknowledgement", () => {
  test("acknowledges the highest cursor only after the async plan is accepted", async () => {
    const accepted = deferred();
    const acknowledged: string[] = [];
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => acknowledged.push(eventId),
      delayMs: 150,
      onBatch: () => accepted.promise,
    });
    batcher.enqueue(event("11"));
    batcher.enqueue(event("12"));

    const flushing = batcher.flushNow();
    await Promise.resolve();
    expect(acknowledged).toEqual([]);

    accepted.resolve();
    await flushing;
    expect(acknowledged).toEqual(["12"]);
  });

  test("leaves rejected or torn-down pending work unacknowledged", async () => {
    const accepted = deferred();
    const acknowledged: string[] = [];
    const errors: unknown[] = [];
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => acknowledged.push(eventId),
      delayMs: 150,
      onBatch: () => accepted.promise,
      onError: (error) => errors.push(error),
    });
    batcher.enqueue(event("21"));
    const flushing = batcher.flushNow();
    accepted.reject(new Error("coordinator unavailable"));
    await flushing;

    expect(acknowledged).toEqual([]);
    expect(errors).toHaveLength(1);

    batcher.enqueue(event("22"));
    batcher.dispose();
    await Promise.resolve();
    expect(acknowledged).toEqual([]);
  });

  test("retries a rejected batch and acknowledges it only after retry acceptance", async () => {
    const retryStarted = deferred();
    const acknowledged = deferred();
    const acknowledgedIds: string[] = [];
    const scheduled: Array<{
      callback: () => void;
      canceled: boolean;
      delayMs: number;
    }> = [];
    let attempt = 0;
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => {
        acknowledgedIds.push(eventId);
        acknowledged.resolve();
      },
      delayMs: 150,
      onBatch: () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("coordinator temporarily unavailable");
        }
        retryStarted.resolve();
      },
      schedule: (callback, delayMs) => {
        const entry = { callback, canceled: false, delayMs };
        scheduled.push(entry);
        return () => {
          entry.canceled = true;
        };
      },
    });
    batcher.enqueue(event("25"));

    await batcher.flushNow();

    expect(attempt).toBe(1);
    expect(acknowledgedIds).toEqual([]);
    const retry = scheduled.find((entry) => !entry.canceled);
    expect(retry?.delayMs).toBe(300);

    retry?.callback();
    await retryStarted.promise;
    await acknowledged.promise;

    expect(attempt).toBe(2);
    expect(acknowledgedIds).toEqual(["25"]);
  });

  test("leaves accepted in-flight work replayable after teardown", async () => {
    const accepted = deferred();
    const acknowledged: string[] = [];
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => acknowledged.push(eventId),
      delayMs: 150,
      onBatch: () => accepted.promise,
    });
    batcher.enqueue(event("31"));
    const flushing = batcher.flushNow();
    batcher.dispose();
    accepted.resolve();
    await flushing;

    expect(acknowledged).toEqual([]);
  });

  test("drops an old rejected batch after reset without displacing new events", async () => {
    const oldBatch = deferred();
    const acknowledged: string[] = [];
    const batches: string[][] = [];
    const errors: unknown[] = [];
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => acknowledged.push(eventId),
      delayMs: 150,
      onBatch: (events) => {
        batches.push(events.map((item) => item.eventId));
        return batches.length === 1 ? oldBatch.promise : undefined;
      },
      onError: (error) => errors.push(error),
    });

    batcher.enqueue(event("35"));
    const oldFlush = batcher.flushNow();
    await Promise.resolve();
    batcher.reset();
    batcher.enqueue(event("36"));
    oldBatch.reject(new Error("old coordinator failure"));
    await oldFlush;

    expect(acknowledged).toEqual([]);
    expect(errors).toEqual([]);

    await batcher.flushNow();
    expect(batches).toEqual([["35"], ["36"]]);
    expect(acknowledged).toEqual(["36"]);
  });

  test("coalesces unknown v1 events into one resync before acknowledgement", async () => {
    const canonicalResync = deferred();
    const acknowledged: string[] = [];
    const issues: string[] = [];
    const targetedBatches: string[][] = [];
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => acknowledged.push(eventId),
      delayMs: 150,
      onBatch: (events) =>
        acceptEarnRealtimeInvalidationBatch({
          events,
          onInvalidationBatch: (supported) => {
            targetedBatches.push(supported.map((item) => item.eventId));
          },
          onProtocolIssue: (issue) => issues.push(issue.eventType),
          onResyncRequired: () => canonicalResync.promise,
        }),
    });
    batcher.enqueue(event("41"));
    batcher.enqueue(event("42", "earn.future.changed"));
    batcher.enqueue(event("43", "earn.future.changed"));

    const flushing = batcher.flushNow();
    await Promise.resolve();
    expect(acknowledged).toEqual([]);
    expect(targetedBatches).toEqual([["41"]]);
    expect(issues).toEqual(["earn.future.changed"]);

    canonicalResync.resolve();
    await flushing;
    expect(acknowledged).toEqual(["43"]);
  });

  test("keeps an unknown event unacknowledged until conservative resync succeeds", async () => {
    const acknowledged: string[] = [];
    const resyncErrors: unknown[] = [];
    let resyncCount = 0;
    const batcher = new EarnRealtimeInvalidationBatcher({
      acknowledge: (eventId) => acknowledged.push(eventId),
      delayMs: 150,
      onBatch: (events) =>
        acceptEarnRealtimeInvalidationBatch({
          events,
          onInvalidationBatch: () => undefined,
          onResyncError: (error) => resyncErrors.push(error),
          onResyncRequired: () => {
            resyncCount += 1;
            if (resyncCount === 1) {
              throw new Error("canonical refresh unavailable");
            }
          },
        }),
    });
    batcher.enqueue(event("51", "earn.future.changed"));

    await batcher.flushNow();

    expect(resyncCount).toBe(1);
    expect(resyncErrors).toHaveLength(1);
    expect(acknowledged).toEqual([]);

    await batcher.flushNow();
    expect(resyncCount).toBe(2);
    expect(acknowledged).toEqual(["51"]);
  });
});
