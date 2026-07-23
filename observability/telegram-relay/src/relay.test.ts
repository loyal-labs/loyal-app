import { describe, expect, test } from "bun:test";

import { AlertRelay, type ClickStackWebhookPayload } from "./relay.ts";

const alertPayload: ClickStackWebhookPayload = {
  eventId: "alert-errors-service-loyal-mobile",
  state: "ALERT",
  title: "Alert for Errors",
  body: "3 lines found",
  link: "https://clickstack.example/search/1",
  startTime: 1,
  endTime: 2,
};

function createRelay(
  sender: (payload: ClickStackWebhookPayload) => Promise<void>,
  now: () => number
) {
  return new AlertRelay(sender, {
    cooldownMs: 60 * 60 * 1000,
    idempotencyTtlMs: 24 * 60 * 60 * 1000,
    maxCacheEntries: 100,
    now,
  });
}

describe("AlertRelay", () => {
  test("sends the first alert and suppresses the same event during cooldown", async () => {
    let now = 1_000;
    const sent: ClickStackWebhookPayload[] = [];
    const relay = createRelay(
      async (payload) => {
        sent.push(payload);
      },
      () => now
    );

    expect(await relay.handle(alertPayload, "delivery-1")).toEqual({
      outcome: "sent",
    });
    now += 10_000;
    expect(await relay.handle(alertPayload, "delivery-2")).toEqual({
      outcome: "suppressed",
    });
    expect(sent).toHaveLength(1);
  });

  test("recognizes an exact delivery retry by Idempotency-Key", async () => {
    const sent: ClickStackWebhookPayload[] = [];
    const relay = createRelay(
      async (payload) => {
        sent.push(payload);
      },
      () => 1_000
    );

    await relay.handle(alertPayload, "same-delivery");
    expect(await relay.handle(alertPayload, "same-delivery")).toEqual({
      outcome: "duplicate",
    });
    expect(sent).toHaveLength(1);
  });

  test("serializes the same Idempotency-Key across different events", async () => {
    let releaseFirstSend: () => void = () => undefined;
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    let markFirstSendStarted: () => void = () => undefined;
    const firstSendStarted = new Promise<void>((resolve) => {
      markFirstSendStarted = resolve;
    });
    const sent: ClickStackWebhookPayload[] = [];
    const relay = createRelay(
      async (payload) => {
        sent.push(payload);
        markFirstSendStarted();
        await firstSendGate;
      },
      () => 1_000
    );

    const first = relay.handle(alertPayload, "same-delivery");
    const second = relay.handle(
      { ...alertPayload, eventId: "another-event" },
      "same-delivery"
    );
    await firstSendStarted;

    expect(sent).toHaveLength(1);
    releaseFirstSend();
    expect(await first).toEqual({ outcome: "sent" });
    expect(await second).toEqual({ outcome: "duplicate" });
    expect(sent).toHaveLength(1);
  });

  test("keeps a flapping alert suppressed across OK recoveries", async () => {
    let now = 1_000;
    const sent: ClickStackWebhookPayload[] = [];
    const relay = createRelay(
      async (payload) => {
        sent.push(payload);
      },
      () => now
    );
    const okPayload = { ...alertPayload, state: "OK" as const };

    expect(await relay.handle(alertPayload, "alert-1")).toEqual({
      outcome: "sent",
    });
    // Two full flap cycles inside the cooldown must stay silent.
    for (const cycle of [1, 2]) {
      now += 60_000;
      expect(await relay.handle(okPayload, `ok-${cycle}`)).toEqual({
        outcome: "resolved",
      });
      now += 60_000;
      expect(await relay.handle(alertPayload, `alert-flap-${cycle}`)).toEqual({
        outcome: "suppressed",
      });
    }
    expect(sent).toHaveLength(1);

    // Once the cooldown expires the event is allowed through again.
    now += 60 * 60 * 1000;
    expect(await relay.handle(alertPayload, "alert-after-cooldown")).toEqual({
      outcome: "sent",
    });
    expect(sent.map((payload) => payload.state)).toEqual(["ALERT", "ALERT"]);
  });

  test("sends again after cooldown expiration", async () => {
    let now = 1_000;
    let sendCount = 0;
    const relay = createRelay(
      async () => {
        sendCount += 1;
      },
      () => now
    );

    await relay.handle(alertPayload, "delivery-1");
    now += 60 * 60 * 1000 + 1;
    expect(await relay.handle(alertPayload, "delivery-2")).toEqual({
      outcome: "sent",
    });
    expect(sendCount).toBe(2);
  });

  test("does not poison caches when Telegram delivery fails", async () => {
    let attempt = 0;
    const relay = createRelay(
      async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("Telegram unavailable");
        }
      },
      () => 1_000
    );

    await expect(relay.handle(alertPayload, "delivery-1")).rejects.toThrow(
      "Telegram unavailable"
    );
    expect(await relay.handle(alertPayload, "delivery-1")).toEqual({
      outcome: "sent",
    });
    expect(attempt).toBe(2);
  });

  test("serializes concurrent alerts for the same event", async () => {
    let releaseFirstSend: () => void = () => undefined;
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    let sendCount = 0;
    const relay = createRelay(
      async () => {
        sendCount += 1;
        await firstSendGate;
      },
      () => 1_000
    );

    const first = relay.handle(alertPayload, "delivery-1");
    const second = relay.handle(alertPayload, "delivery-2");
    await Promise.resolve();
    releaseFirstSend();

    expect(await first).toEqual({ outcome: "sent" });
    expect(await second).toEqual({ outcome: "suppressed" });
    expect(sendCount).toBe(1);
  });
});
