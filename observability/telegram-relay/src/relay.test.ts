import { describe, expect, test } from "bun:test";

import { analyzeAlert, formatTelegramMessage } from "./format.ts";
import {
  type AlertContext,
  type AlertMessageKind,
  AlertRelay,
  type ClickStackWebhookPayload,
  type PersistedState,
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

/**
 * These tests start the clock just after the epoch, so the first scheduled
 * recap is 06:00 UTC on the relay's first day. Advancing `now` to this is what
 * makes the daily recap due.
 */
const RECAP_AT = 6 * 60 * 60 * 1000;

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

    // A signature stays quiet for the rest of the reporting period, not just
    // for the cooldown: an hour later it is still suppressed.
    now += 60 * 60 * 1000;
    expect(await relay.handle(alertPayload, "alert-an-hour-later")).toEqual({
      outcome: "suppressed",
    });
    expect(sent).toHaveLength(1);

    // Past the recap it is allowed through again. Closing is silent: what the
    // window swallowed is reported by the daily recap, not here.
    now = RECAP_AT + 1_000;
    expect(await relay.handle(alertPayload, "alert-after-cooldown")).toEqual({
      outcome: "sent",
    });
    expect(sent.map((message) => message.kind)).toEqual(["new", "new"]);
    expect(sent.every((message) => message.state === "ALERT")).toBe(true);
  });

  test("announces a lasting incident once per reporting period", async () => {
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
      outcome: "suppressed",
    });

    now = RECAP_AT + 1;
    expect(await relay.handle(alertPayload, "delivery-3")).toEqual({
      outcome: "sent",
    });
    expect(sendCount).toBe(2);
  });

  test("holds an alert that opens just before a recap into the next period", async () => {
    let now = RECAP_AT - 60_000;
    let sendCount = 0;
    const relay = createRelay(
      async () => {
        sendCount += 1;
      },
      () => now
    );

    await relay.handle(alertPayload, "delivery-1");

    // The recap is a minute away, so aligning to it would let this alert fire
    // again almost at once. The cooldown floor rolls it to the next period.
    now = RECAP_AT + 60_000;
    expect(await relay.handle(alertPayload, "delivery-2")).toEqual({
      outcome: "suppressed",
    });
    expect(sendCount).toBe(1);
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

    // Closing the window posts nothing at all: the counters it carried surface
    // in the scheduled recap, which comes due on the same sweep.
    now = RECAP_AT;
    await relay.sweep(now);
    expect(relay.stats().windows).toBe(0);
    // A second sweep must not repeat a recap that already went out.
    await relay.sweep(now);

    const recaps = sent.filter((context) => context.kind === "daily");
    expect(recaps).toHaveLength(1);
    expect(recaps[0]?.daily?.eventCount).toBe(5);
    expect(recaps[0]?.daily?.deliveries).toBe(4);
    expect(recaps[0]?.daily?.alertsPosted).toBe(1);
    expect(recaps[0]?.daily?.uniqueValues.wallet).toBe(2);

    const text = formatTelegramMessage(payload, {
      alertColumns: CSV_COLUMNS,
      cardinalityColumns: ["wallet"],
      context: recaps[0] as AlertContext,
    }).text;
    expect(text).toContain("📊 Error recap");
    expect(text).toContain("5 events");
    expect(text).toContain("1 alert(s) posted");
    expect(text).toContain("2 unique wallets");
    // The frequency of the individual error, which is the point of the recap.
    expect(text).toContain("<b>×2</b> queue transition failed");
  });

  test("counts an error that never repeated, so it still reaches the recap", async () => {
    let now = 1_000;
    const sent: AlertContext[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        sent.push(context);
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

    now = RECAP_AT;
    await relay.sweep(now);

    const recap = sent.find((context) => context.kind === "daily");
    expect(recap?.daily?.signatures).toHaveLength(1);
    expect(recap?.daily?.signatures[0]?.count).toBe(1);
    expect(recap?.daily?.signatures[0]?.headline).toBe(
      "earn.withdrawal.prepare.failed"
    );
  });

  test("counts a delivery once when its alert had to be retried", async () => {
    let now = 1_000;
    let telegramAvailable = false;
    const sent: AlertContext[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        if (context.kind === "new" && !telegramAvailable) {
          throw new Error("Telegram unavailable");
        }
        sent.push(context);
      },
      () => now,
      { analyze }
    );
    const payload = csvPayload("loyal-mobile", [
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
    ]);

    // The alert fails, so no window is registered and ClickStack retries under
    // a fresh key. The tally must not count the same delivery twice just
    // because the message needed two attempts.
    await expect(relay.handle(payload, "delivery-1")).rejects.toThrow(
      "Telegram unavailable"
    );
    telegramAvailable = true;
    now += 1_000;
    expect(await relay.handle(payload, "delivery-2")).toEqual({
      outcome: "sent",
    });

    now = RECAP_AT;
    await relay.sweep(now);

    const recap = sent.find((context) => context.kind === "daily");
    expect(recap?.daily?.eventCount).toBe(1);
    expect(recap?.daily?.signatures[0]?.count).toBe(1);
    expect(recap?.daily?.alertsPosted).toBe(1);
  });

  test("keeps a tally whose recap came due while the process was down", async () => {
    let now = 1_000;
    const before = createRelay(
      async () => undefined,
      () => now,
      { analyze }
    );
    await before.handle(
      csvPayload("loyal-mobile", [
        row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
      ]),
      "delivery-1"
    );
    const snapshot = JSON.parse(
      JSON.stringify(before.exportState(now))
    ) as PersistedState;

    // The relay comes back after the scheduled time. Dropping the tally here
    // would silently lose a whole period of counting.
    const sent: AlertContext[] = [];
    now = RECAP_AT + 60_000;
    const after = createRelay(
      async (_payload, context) => {
        sent.push(context);
      },
      () => now,
      { analyze, startedAt: now }
    );
    after.importState(snapshot, now);
    await after.sweep(now);

    const recap = sent.find((context) => context.kind === "daily");
    expect(recap?.daily?.eventCount).toBe(1);
  });

  test("marks a wallet count the relay stopped retaining as a floor", async () => {
    let now = 1_000;
    const sent: AlertContext[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        sent.push(context);
      },
      () => now,
      { analyze }
    );

    // More distinct wallets than the relay keeps. The count it can report is
    // then a floor, and presenting it as a total would turn a bounded set into
    // a confident, wrong number.
    for (let batch = 0; batch < 12; batch += 1) {
      const rows = Array.from({ length: 50 }, (_unused, index) =>
        row(
          "loyal-mobile",
          "earn.withdrawal.prepare.failed",
          `wallet-${batch * 50 + index}`
        )
      );
      await relay.handle(
        csvPayload("loyal-mobile", rows, {
          startTime: batch,
          endTime: batch + 1,
        }),
        `delivery-${batch}`
      );
      now += 60_000;
    }

    now = RECAP_AT;
    await relay.sweep(now);

    const recap = sent.find((context) => context.kind === "daily");
    expect(recap?.daily?.uniqueValues.wallet).toBe(500);
    expect(recap?.daily?.cappedValues).toContain("wallet");

    const text = formatTelegramMessage(csvPayload("loyal-mobile", []), {
      alertColumns: CSV_COLUMNS,
      cardinalityColumns: ["wallet"],
      context: recap as AlertContext,
    }).text;
    expect(text).toContain("\u2265500 unique wallets");
  });

  test("posts no recap for a period in which nothing fired", async () => {
    let now = 1_000;
    const kinds: AlertMessageKind[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        kinds.push(context.kind);
      },
      () => now,
      { analyze }
    );

    now = RECAP_AT;
    await relay.sweep(now);

    expect(kinds).toEqual([]);
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

    now = RECAP_AT + 1;
    await relay.sweep(now);

    expect(kinds).toEqual(["new", "daily"]);
    expect(relay.stats().windows).toBe(0);
  });

  test("retries a rejected recap with its counters intact", async () => {
    let now = 1_000;
    let telegramAvailable = true;
    const recaps: AlertContext[] = [];
    const relay = createRelay(
      async (_payload, context) => {
        if (context.kind !== "daily") {
          return;
        }
        if (!telegramAvailable) {
          throw new Error("Telegram unavailable");
        }
        recaps.push(context);
      },
      () => now,
      { analyze }
    );
    const payload = csvPayload("loyal-mobile", [
      row("loyal-mobile", "earn.withdrawal.prepare.failed", "wallet-a"),
    ]);

    await relay.handle(payload, "delivery-1");
    now += 1_000;
    // Same evaluation range redelivered: two deliveries, but one event.
    await relay.handle(payload, "delivery-2");

    now = RECAP_AT;
    telegramAvailable = false;
    await relay.sweep(now);
    expect(recaps).toHaveLength(0);
    // The closed period moved into the pending recap rather than being lost,
    // and the live tally started clean so later deliveries are not swept into
    // a period that has already been reported.
    expect(relay.stats().pendingRecapEvents).toBe(1);
    expect(relay.stats().dailyEvents).toBe(0);

    telegramAvailable = true;
    await relay.sweep(now);
    expect(recaps).toHaveLength(1);
    expect(recaps[0]?.daily?.eventCount).toBe(1);
    expect(recaps[0]?.daily?.deliveries).toBe(2);

    // Nothing is left over to double-report tomorrow.
    expect(relay.stats().pendingRecapEvents).toBe(0);
    expect(relay.stats().dailyEvents).toBe(0);
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

  test("a malformed snapshot restores nothing instead of throwing", async () => {
    // This runs at boot. A throw would kill the process before it binds a
    // port, and Render would restart it into the same bad row forever, so a
    // snapshot that cannot be read has to degrade to an empty start.
    const now = Date.parse("2026-01-01T09:00:00Z");
    const relay = createRelay(
      async () => undefined,
      () => now
    );

    const malformed = [
      // Truncated column: the whole windows array is gone.
      { version: 2, savedAt: now, windows: undefined },
      // Wrong type where an array is expected.
      { version: 2, savedAt: now, windows: {} },
      // A window missing the fields deserialization walks.
      {
        version: 2,
        savedAt: now,
        windows: [{ key: "k", expiresAt: now + 60_000 }],
      },
      // A tally that is due but unreadable.
      {
        version: 2,
        savedAt: now,
        windows: [],
        daily: { since: now } as never,
        nextRecapAt: now,
      },
    ] as unknown as PersistedState[];

    for (const state of malformed) {
      expect(relay.importState(state, now)).toBe(0);
    }

    // Still usable afterwards: a bad snapshot must not leave the relay in a
    // state where it stops alerting.
    expect(await relay.handle(alertPayload, "delivery-1")).toEqual({
      outcome: "sent",
    });
  });
});
