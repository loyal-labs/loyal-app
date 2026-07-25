import { describe, expect, test } from "bun:test";

import { analyzeAlert, formatTelegramMessage } from "./format.ts";
import {
  type AlertContext,
  type AlertMessageKind,
  AlertRelay,
  type ClickStackWebhookPayload,
  type TelegramSender,
} from "./relay.ts";

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
  sender: TelegramSender,
  now: () => number,
  options: Partial<ConstructorParameters<typeof AlertRelay>[1]> = {}
) {
  return new AlertRelay(sender, {
    cooldownMs: 60 * 60 * 1000,
    idempotencyTtlMs: 24 * 60 * 60 * 1000,
    maxCacheEntries: 100,
    now,
    ...options,
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
    const sent: { state: string; kind: AlertMessageKind }[] = [];
    const relay = createRelay(
      async (payload, context) => {
        sent.push({ state: payload.state, kind: context.kind });
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

    // Once the window closes the event is allowed through again, preceded by
    // the recap of what the window swallowed.
    now += 60 * 60 * 1000;
    expect(await relay.handle(alertPayload, "alert-after-cooldown")).toEqual({
      outcome: "sent",
    });
    expect(sent.map((message) => message.kind)).toEqual([
      "new",
      "digest",
      "new",
    ]);
    expect(sent.every((message) => message.state === "ALERT")).toBe(true);
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

const CSV_COLUMNS = [
  "Timestamp",
  "ServiceName",
  "SeverityText",
  "Body",
  "wallet",
];

/** A ClickStack alert body: preamble, then a fenced block of quoted rows. */
function csvPayload(
  group: string,
  rows: string[][],
  overrides: Partial<ClickStackWebhookPayload> = {}
): ClickStackWebhookPayload {
  return {
    eventId: `alert-errors-${group}`,
    state: "ALERT",
    title: `🚨 Alert for "Errors" - ${rows.length} lines found`,
    body: [
      `Group: "ServiceName:${group}"`,
      `${rows.length} lines found`,
      "```",
      ...rows.map((row) => row.map((field) => `"${field}"`).join(",")),
      "```",
    ].join("\n"),
    link: "https://clickstack.example/search/1",
    startTime: 1,
    endTime: 2,
    ...overrides,
  };
}

function row(service: string, body: string, wallet: string): string[] {
  return ["2026-07-25T09:41:23.000000000Z", service, "error", body, wallet];
}

const analyze = (payload: ClickStackWebhookPayload) =>
  analyzeAlert(payload, {
    alertColumns: CSV_COLUMNS,
    cardinalityColumns: ["wallet"],
  });

describe("AlertRelay windows", () => {
  test("reports how many alerts a closed window swallowed", async () => {
    let now = 1_000;
    const sent: AlertContext[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        sent.push(context);
      },
      () => now,
      { analyze }
    );
    // ClickStack truncates the row block it sends, so the title reports more
    // matched lines than the block carries.
    const payload = csvPayload(
      "loyal-fleet-route-executor",
      [
        row(
          "loyal-fleet-route-executor",
          "queue transition failed",
          "wallet-a"
        ),
        row(
          "loyal-fleet-route-executor",
          "queue transition failed",
          "wallet-b"
        ),
      ],
      { title: '🚨 Alert for "Errors" - 5 lines found' }
    );

    expect(await relay.handle(payload, "delivery-1")).toEqual({
      outcome: "sent",
    });
    for (const attempt of [2, 3, 4]) {
      now += 1_000;
      expect(await relay.handle(payload, `delivery-${attempt}`)).toEqual({
        outcome: "suppressed",
      });
    }

    now += 60 * 60 * 1000;
    await relay.sweep(now);
    // A second sweep must not repeat a digest that already went out.
    await relay.sweep(now);

    const digests = sent.filter((context) => context.kind === "digest");
    expect(digests).toHaveLength(1);
    expect(digests[0]?.window?.suppressedAlerts).toBe(3);
    expect(digests[0]?.window?.eventCount).toBe(5);
    expect(digests[0]?.window?.uniqueValues.wallet).toBe(2);
    expect(relay.stats().windows).toBe(0);

    const text = formatTelegramMessage(payload, {
      alertColumns: CSV_COLUMNS,
      cardinalityColumns: ["wallet"],
      context: digests[0] as AlertContext,
    }).text;
    expect(text).toContain("3 alert(s) suppressed");
    // Only 2 of the 5 matched lines were readable, so the wallet spread has
    // to be presented as a floor rather than a total.
    expect(text).toContain("≥2 unique wallets");
  });

  test("closes a window silently when it suppressed nothing", async () => {
    let now = 1_000;
    const kinds: AlertMessageKind[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        kinds.push(context.kind);
      },
      () => now,
      { analyze }
    );

    await relay.handle(
      csvPayload("loyal-mobile", [
        row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
      ]),
      "delivery-1"
    );

    now += 60 * 60 * 1000 + 1;
    await relay.sweep(now);

    expect(kinds).toEqual(["new"]);
    expect(relay.stats().windows).toBe(0);
  });

  test("retries a rejected digest with its counters intact", async () => {
    let now = 1_000;
    let telegramAvailable = true;
    const digests: AlertContext[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        if (context.kind !== "digest") {
          return;
        }
        if (!telegramAvailable) {
          throw new Error("Telegram unavailable");
        }
        digests.push(context);
      },
      () => now,
      { analyze }
    );
    const payload = csvPayload("loyal-mobile", [
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
    ]);

    await relay.handle(payload, "delivery-1");
    now += 1_000;
    await relay.handle(payload, "delivery-2");

    now += 60 * 60 * 1000;
    telegramAvailable = false;
    await relay.sweep(now);
    expect(digests).toHaveLength(0);
    expect(relay.stats().pendingDigests).toBe(1);

    telegramAvailable = true;
    await relay.sweep(now);
    expect(digests).toHaveLength(1);
    expect(digests[0]?.window?.suppressedAlerts).toBe(1);
  });

  test("collapses one incident that ClickStack split across groups", async () => {
    const now = 1_000;
    const kinds: AlertMessageKind[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        kinds.push(context.kind);
      },
      () => now,
      { analyze }
    );

    // ClickStack groups by service but sends the same unfiltered rows to each
    // group, so one incident arrives as several deliveries.
    const rows = [
      row("loyal-fleet-opportunity-planner", "planner stopped", "wallet-a"),
      row("loyal-kamino-reserve-monitor", "monitor stopped", "wallet-a"),
    ];
    expect(
      await relay.handle(
        csvPayload("loyal-fleet-opportunity-planner", rows),
        "delivery-1"
      )
    ).toEqual({ outcome: "sent" });
    expect(
      await relay.handle(
        csvPayload("loyal-kamino-reserve-monitor", rows),
        "delivery-2"
      )
    ).toEqual({ outcome: "suppressed" });

    expect(kinds).toEqual(["new"]);
  });

  test("folds the post-restart burst into a single recap", async () => {
    let now = 1_000;
    const sent: AlertContext[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        sent.push(context);
      },
      () => now,
      { analyze, restartGraceMs: 120_000, startedAt: 1_000 }
    );

    // ClickStack replays every live alert within seconds of a deploy.
    expect(
      await relay.handle(
        csvPayload("loyal-mobile", [
          row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
        ]),
        "delivery-1"
      )
    ).toEqual({ outcome: "deferred" });
    now += 5_000;
    expect(
      await relay.handle(
        csvPayload("loyal-fleet-route-reconciler", [
          row("loyal-fleet-route-reconciler", "sweep refresh failed", ""),
        ]),
        "delivery-2"
      )
    ).toEqual({ outcome: "deferred" });

    await relay.sweep(now);
    expect(sent).toHaveLength(0);

    now = 1_000 + 120_001;
    await relay.sweep(now);
    await relay.sweep(now);

    expect(sent.map((context) => context.kind)).toEqual(["restart"]);
    expect(sent[0]?.windows).toHaveLength(2);
    expect(sent[0]?.silent).toBe(true);
  });

  test("retries an escalation Telegram rejected on the next delivery", async () => {
    let now = 1_000;
    let telegramAvailable = true;
    const kinds: AlertMessageKind[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        if (context.kind === "escalation" && !telegramAvailable) {
          throw new Error("Telegram unavailable");
        }
        kinds.push(context.kind);
      },
      () => now,
      { analyze, escalationMultiplier: 3 }
    );
    // One matched line opens the window, so escalation is due when a single
    // evaluation grows to three events.
    const payload = csvPayload("loyal-mobile", [
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
    ]);
    const burst = csvPayload("loyal-mobile", [
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
    ]);

    await relay.handle(payload, "delivery-1");
    now += 1_000;
    await relay.handle(payload, "delivery-2");

    telegramAvailable = false;
    now += 1_000;
    // A failed escalation must not fail the webhook: the delivery is already
    // counted, and ClickStack's retry would be answered as a duplicate.
    expect(await relay.handle(burst, "delivery-3")).toEqual({
      outcome: "suppressed",
    });
    expect(kinds).toEqual(["new"]);

    telegramAvailable = true;
    now += 1_000;
    await relay.handle(burst, "delivery-4");
    expect(kinds).toEqual(["new", "escalation"]);
  });

  test("does not escalate unchanged evaluation replays", async () => {
    let now = 1_000;
    const kinds: AlertMessageKind[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        kinds.push(context.kind);
      },
      () => now,
      { analyze, escalationMultiplier: 3 }
    );
    const payload = csvPayload("loyal-mobile", [
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
    ]);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await relay.handle(payload, `delivery-${attempt}`);
      now += 1_000;
    }

    expect(kinds).toEqual(["new"]);
    expect(relay.exportState(now).windows[0]?.eventCount).toBe(1);
  });

  test("does not escalate steady volume across evaluation ranges", async () => {
    let now = 1_000;
    const kinds: AlertMessageKind[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        kinds.push(context.kind);
      },
      () => now,
      { analyze, escalationMultiplier: 3 }
    );

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await relay.handle(
        csvPayload(
          "loyal-mobile",
          [row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a")],
          { startTime: attempt, endTime: attempt + 1 }
        ),
        `delivery-${attempt}`
      );
      now += 1_000;
    }

    expect(kinds).toEqual(["new"]);
    expect(relay.exportState(now).windows[0]?.eventCount).toBe(10);
  });

  test("restores unexpired windows from a snapshot", async () => {
    const now = 1_000;
    const kinds: AlertMessageKind[] = [];
    const source = createRelay(
      async () => undefined,
      () => now,
      { analyze }
    );
    const payload = csvPayload("loyal-mobile", [
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
    ]);
    await source.handle(payload, "delivery-1");

    const restored = createRelay(
      async (_payload, context) => {
        kinds.push(context.kind);
      },
      () => now,
      { analyze }
    );
    expect(restored.importState(source.exportState(now), now)).toBe(1);

    // The signature is already muted, so a redeploy does not re-announce it.
    expect(await restored.handle(payload, "delivery-2")).toEqual({
      outcome: "suppressed",
    });
    expect(kinds).toEqual([]);
    expect(restored.exportState(now).windows[0]?.eventCount).toBe(1);
  });
});
