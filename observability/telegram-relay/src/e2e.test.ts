import { describe, expect, test } from "bun:test";

import {
  createAlertAnalyzer,
  createRequestHandler,
  createTelegramSender,
  loadConfig,
} from "./app.ts";
import { AlertRelay, type PersistedState } from "./relay.ts";

/**
 * End-to-end coverage of the relay. A real ClickStack webhook request goes in
 * through the HTTP handler, through the real analyzer, formatter and Telegram
 * sender, and is captured at the Telegram Bot API boundary. Nothing between
 * those two ends is stubbed.
 *
 * Time is injected everywhere. Windows, the idempotency TTL and the recap
 * schedule all read the fake clock, so a code path that reached for
 * `Date.now()` would render timestamps these assertions do not expect, and
 * `sleep` is a no-op recorder so a backoff cannot hide behind a slow test.
 */

/** A fixed point, so every rendered timestamp is predictable. */
const START = Date.UTC(2026, 6, 25, 4, 50, 0);
const MINUTE = 60_000;

const ALERT_COLUMNS = [
  "Timestamp",
  "ServiceName",
  "SeverityText",
  "Body",
  "env",
  "flow",
  "stage",
  "error_code",
  "wallet",
];

interface TelegramCall {
  /** Fake-clock reading when the request reached the Telegram boundary. */
  at: number;
  text: string;
  parseMode?: string;
  silent: boolean;
  chatId: string;
}

interface TelegramReply {
  status: number;
  body: unknown;
}

interface SystemOptions {
  env?: Record<string, string | undefined>;
  startAt?: number;
  /** Returns a reply to force, or undefined to let the send succeed. */
  reply?: (call: { text: string; index: number }) => TelegramReply | undefined;
}

function createSystem(options: SystemOptions = {}) {
  const startAt = options.startAt ?? START;
  let now = startAt;
  const calls: TelegramCall[] = [];
  const slept: number[] = [];

  const config = loadConfig({
    CLICKSTACK_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_BOT_TOKEN: "1234567:test-token",
    TELEGRAM_CHAT_ID: "-1001234567890",
    ALERT_COLUMNS: ALERT_COLUMNS.join(","),
    CARDINALITY_COLUMNS: "wallet",
    ...options.env,
  });

  const sender = createTelegramSender(
    config,
    async (url, init) => {
      expect(url).toContain("/bot1234567:test-token/sendMessage");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const text = String(body.text);
      calls.push({
        at: now,
        text,
        parseMode: body.parse_mode as string | undefined,
        silent: body.disable_notification === true,
        chatId: String(body.chat_id),
      });

      const forced = options.reply?.({ text, index: calls.length - 1 });
      if (!forced) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify(forced.body), {
        status: forced.status,
      });
    },
    async (ms) => {
      slept.push(ms);
    }
  );

  const relay = new AlertRelay(sender, {
    cooldownMs: config.cooldownMs,
    idempotencyTtlMs: config.idempotencyTtlMs,
    maxCacheEntries: config.maxCacheEntries,
    now: () => now,
    analyze: createAlertAnalyzer(config),
    dailyRecapEnabled: config.dailyRecapEnabled,
    dailyRecapAtMinutes: config.dailyRecapAtMinutes,
    startedAt: startAt,
  });

  const handler = createRequestHandler(relay, config);

  return {
    calls,
    slept,
    relay,
    config,
    clock: () => now,
    advance(ms: number) {
      now += ms;
    },
    advanceTo(target: number) {
      now = target;
    },
    sweep() {
      return relay.sweep();
    },
    post(
      payload: unknown,
      idempotencyKey: string,
      headers: Record<string, string> = {}
    ) {
      return handler(
        new Request("http://relay.internal/webhooks/clickstack", {
          method: "POST",
          headers: {
            Authorization: "Bearer test-secret",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            ...headers,
          },
          body: typeof payload === "string" ? payload : JSON.stringify(payload),
        })
      );
    },
    get(path: string) {
      return handler(new Request(`http://relay.internal${path}`));
    },
  };
}

type System = ReturnType<typeof createSystem>;

interface AlertRow {
  service: string;
  body: string;
  wallet?: string;
  errorCode?: string;
  at?: string;
}

/** A payload shaped exactly like ClickStack's generic webhook body. */
function alert(options: {
  group: string;
  rows: AlertRow[];
  /** Matched-line count, which ClickStack reports above the rows it sends. */
  lines?: number;
  eventId?: string;
}) {
  const lines = options.lines ?? options.rows.length;
  const csv = options.rows.map((row) =>
    [
      row.at ?? "2026-07-25T04:50:12.123456789Z",
      row.service,
      "error",
      row.body,
      "production",
      "earn.withdrawal",
      "prepare",
      row.errorCode ?? "unexpected_error",
      row.wallet ?? "",
    ]
      .map((field) => `"${field}"`)
      .join(",")
  );

  return {
    eventId: options.eventId ?? `alert-errors-${options.group}`,
    state: "ALERT",
    title: `🚨 Alert for "Errors" - ${lines} lines found`,
    body: [
      `Group: "ServiceName:${options.group}"`,
      `${lines} lines found, which meets or exceeds the threshold of 1 lines`,
      "Time Range (UTC): [Jul 25 4:50:00 AM - Jul 25 4:51:00 AM)",
      "",
      "```",
      ...csv,
      "```",
    ].join("\n"),
    link: "https://clickstack.example/search/abc?from=1784955000000&to=1784955060000",
    startTime: 1_784_955_000_000,
    endTime: 1_784_955_060_000,
  };
}

const withdrawalRows: AlertRow[] = [
  {
    service: "loyal-mobile",
    body: "earn.withdrawal.prepare.failed",
    wallet: "7XkWalletAaa",
    errorCode: "request_failed",
  },
  {
    service: "loyal-mobile",
    body: "earn.withdrawal.prepare.failed",
    wallet: "9fApWalletBbb",
    at: "2026-07-25T04:50:44.500000000Z",
  },
];

async function outcomeOf(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const body = (await response.json()) as { outcome?: string };
  return String(body.outcome);
}

/**
 * The next occurrence of a UTC minute-of-day after `from`, computed here
 * rather than imported so the schedule assertion does not simply restate the
 * implementation it is checking.
 */
function recapAfter(from: number, atMinutes: number): number {
  const day = new Date(from);
  const midnight = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate()
  );
  const candidate = midnight + atMinutes * 60_000;
  return candidate > from ? candidate : candidate + 24 * 60 * MINUTE;
}

/**
 * Invariants that must hold for every message the relay emits, checked across
 * the whole run rather than per assertion. These catch what a content-only
 * assertion lets through: a message past the Telegram limit, unbalanced HTML
 * that Telegram rejects wholesale, an unescaped ampersand out of a search URL,
 * a split surrogate pair, or a send ordered against a clock that is not the
 * injected one.
 */
function verifyInvariants(system: System): void {
  let previousAt = Number.NEGATIVE_INFINITY;

  for (const call of system.calls) {
    expect(call.chatId).toBe("-1001234567890");
    expect(call.text.length).toBeGreaterThan(0);
    expect(call.text.length).toBeLessThanOrEqual(4096);

    // Sends are ordered by the fake clock. Anything scheduled off a real timer
    // would not stay ordered against these readings.
    expect(call.at).toBeGreaterThanOrEqual(previousAt);
    previousAt = call.at;

    if (call.parseMode !== "HTML") {
      continue;
    }

    for (const tag of ["b", "i", "code"]) {
      const open = call.text.match(new RegExp(`<${tag}>`, "g"))?.length ?? 0;
      const close = call.text.match(new RegExp(`</${tag}>`, "g"))?.length ?? 0;
      expect(`${tag} open ${open}`).toBe(`${tag} open ${close}`);
    }

    const withoutEntities = call.text.replaceAll(
      /&(amp|lt|gt|quot|#\d+);/g,
      ""
    );
    expect(withoutEntities).not.toContain("&");

    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(call.text)).toBe(false);
  }
}

describe("relay end to end", () => {
  test("walks a full alert lifecycle over a mocked clock", async () => {
    const system = createSystem();

    // --- Request surface -------------------------------------------------
    expect((await system.get("/healthz")).status).toBe(200);
    expect((await system.get("/nope")).status).toBe(404);

    const rejected = alert({ group: "loyal-mobile", rows: withdrawalRows });
    expect(
      (await system.post(rejected, "d-auth", { Authorization: "Bearer wrong" }))
        .status
    ).toBe(401);
    expect(
      (await system.post(rejected, "", { "Idempotency-Key": "" })).status
    ).toBe(400);
    expect((await system.post("{not json", "d-json")).status).toBe(400);
    expect(
      (await system.post({ ...rejected, state: 1 }, "d-type")).status
    ).toBe(400);
    expect(system.calls).toHaveLength(0);

    // --- First alert opens a window --------------------------------------
    // ClickStack matched six lines but only sent two of them.
    const payload = alert({
      group: "loyal-mobile",
      rows: withdrawalRows,
      lines: 6,
    });
    expect(await outcomeOf(await system.post(payload, "d-1"))).toBe("sent");

    expect(system.calls).toHaveLength(1);
    const opening = system.calls[0]!;
    expect(opening.at).toBe(START);
    expect(opening.parseMode).toBe("HTML");
    expect(opening.silent).toBe(false);
    expect(opening.text).toContain('<b>🚨 Alert for "Errors"</b>');
    // ClickStack's own count is replaced by the relay's own stats line.
    expect(opening.text).not.toContain("lines found");
    expect(opening.text).toContain('Group: "ServiceName:loyal-mobile"');
    expect(opening.text).toContain(
      "<i>6 events · ≥2 unique wallets · muted 1h10m</i>"
    );
    expect(opening.text).toContain("🔴 <b>error</b> · 04:50:44 UTC");
    expect(opening.text).toContain("error_code: <code>request_failed</code>");
    expect(opening.text).toContain("wallet: <code>7XkWalletAaa</code>");
    expect(opening.text.endsWith("to=1784955060000")).toBe(true);

    // --- Repeats are tracked, not recounted or posted --------------------
    system.advance(MINUTE);
    expect(await outcomeOf(await system.post(payload, "d-2"))).toBe(
      "suppressed"
    );
    // The identical delivery, replayed by ClickStack.
    expect(await outcomeOf(await system.post(payload, "d-2"))).toBe(
      "duplicate"
    );

    // A recovery is acknowledged and leaves the window running.
    system.advance(MINUTE);
    expect(
      await outcomeOf(await system.post({ ...payload, state: "OK" }, "d-ok"))
    ).toBe("resolved");

    // One incident that ClickStack split across groups is still one window.
    system.advance(MINUTE);
    expect(
      await outcomeOf(
        await system.post(
          { ...payload, eventId: "alert-errors-other-group" },
          "d-3"
        )
      )
    ).toBe("suppressed");
    expect(system.calls).toHaveLength(1);

    // --- Volume exploding is counted, not announced ----------------------
    // The opening delivery reported 6 events; 80 is the same incident getting
    // worse, and it stays inside the window until the recap reports it.
    system.advance(MINUTE);
    expect(
      await outcomeOf(
        await system.post(
          alert({ group: "loyal-mobile", rows: withdrawalRows, lines: 80 }),
          "d-burst"
        )
      )
    ).toBe("suppressed");
    expect(system.calls).toHaveLength(1);

    // --- The incident stays quiet for the rest of the period -------------
    // The window runs to the recap, not to the cooldown, so an hour in the
    // signature is still muted rather than re-announced.
    const expiresAt = recapAfter(START, system.config.dailyRecapAtMinutes);
    expect(expiresAt).toBeGreaterThan(START + system.config.cooldownMs);

    system.advanceTo(START + system.config.cooldownMs + MINUTE);
    await system.sweep();
    expect(await outcomeOf(await system.post(payload, "d-4"))).toBe(
      "suppressed"
    );
    expect(system.calls).toHaveLength(1);
    expect(system.relay.stats().windows).toBe(1);

    // --- The window closes on its boundary, and says nothing -------------
    system.advanceTo(expiresAt - 1);
    await system.sweep();
    expect(system.calls).toHaveLength(1);
    expect(system.relay.stats().windows).toBe(1);

    // --- One scheduled recap carries the whole period --------------------
    system.advanceTo(expiresAt);
    await system.sweep();
    // A second sweep at the same instant must not repeat the recap.
    await system.sweep();

    expect(system.relay.stats().windows).toBe(0);
    expect(system.calls).toHaveLength(2);
    const recap = system.calls[1]!;
    expect(recap.silent).toBe(true);
    expect(recap.text).toContain("📊 Error recap · last");
    // 80 from the burst; the repeated deliveries of an evaluation range
    // ClickStack had already reported are not counted again.
    expect(recap.text).toContain("80 events");
    expect(recap.text).toContain("1 alert(s) posted");
    expect(recap.text).toContain("≥2 unique wallets");
    expect(recap.text).toContain("<b>×4</b> earn.withdrawal.prepare.failed");
    expect(system.relay.stats().dailyEvents).toBe(0);

    // --- The next period announces it again, once ------------------------
    system.advance(MINUTE);
    expect(await outcomeOf(await system.post(payload, "d-5"))).toBe("sent");
    expect(system.calls).toHaveLength(3);

    verifyInvariants(system);
  });

  test("re-announces every live signature after a restart without a snapshot", async () => {
    const system = createSystem();

    // ClickStack replays every live alert seconds after the relay comes up.
    // With no window state there is nothing to suppress against, so each
    // distinct signature is a first delivery and is posted.
    expect(
      await outcomeOf(
        await system.post(
          alert({ group: "loyal-mobile", rows: withdrawalRows }),
          "r-1"
        )
      )
    ).toBe("sent");

    system.advance(5_000);
    expect(
      await outcomeOf(
        await system.post(
          alert({
            group: "loyal-fleet-route-reconciler",
            rows: [
              {
                service: "loyal-fleet-route-reconciler",
                body: "fleet rebalance vault position refresh failed",
              },
            ],
          }),
          "r-2"
        )
      )
    ).toBe("sent");

    expect(system.calls).toHaveLength(2);
    expect(system.calls.every((call) => call.silent)).toBe(false);

    // Each is muted from then on rather than alerting on every replay.
    system.advance(MINUTE);
    expect(
      await outcomeOf(
        await system.post(
          alert({ group: "loyal-mobile", rows: withdrawalRows }),
          "r-3"
        )
      )
    ).toBe("suppressed");
    expect(system.calls).toHaveLength(2);

    verifyInvariants(system);
  });

  test("survives Telegram rate limits, entity errors and false acks", async () => {
    const payload = alert({ group: "loyal-mobile", rows: withdrawalRows });

    const rateLimited = createSystem({
      reply: ({ index }) =>
        index === 0
          ? { status: 429, body: { ok: false, parameters: { retry_after: 2 } } }
          : undefined,
    });
    expect(await outcomeOf(await rateLimited.post(payload, "d-1"))).toBe(
      "sent"
    );
    expect(rateLimited.slept).toEqual([2000]);
    expect(rateLimited.calls).toHaveLength(2);
    verifyInvariants(rateLimited);

    // A long backoff is handed back to ClickStack instead of being absorbed.
    const heldOff = createSystem({
      reply: () => ({
        status: 429,
        body: { ok: false, parameters: { retry_after: 120 } },
      }),
    });
    expect((await heldOff.post(payload, "d-1")).status).toBe(502);
    expect(heldOff.slept).toEqual([]);

    // A rejected entity falls back to the verbatim ClickStack text.
    const htmlRejected = createSystem({
      reply: ({ index }) =>
        index === 0
          ? { status: 400, body: { ok: false, description: "entities" } }
          : undefined,
    });
    expect(await outcomeOf(await htmlRejected.post(payload, "d-1"))).toBe(
      "sent"
    );
    expect(htmlRejected.calls).toHaveLength(2);
    expect(htmlRejected.calls[0]?.parseMode).toBe("HTML");
    expect(htmlRejected.calls[1]?.parseMode).toBeUndefined();
    expect(htmlRejected.calls[1]?.text).toContain("lines found");

    // HTTP 200 with ok:false is a failure. Accepting it would mute the
    // signature for a full window without anyone having seen the alert.
    const falseAck = createSystem({
      reply: ({ index }) =>
        index === 0
          ? { status: 200, body: { ok: false, description: "no chat" } }
          : undefined,
    });
    expect((await falseAck.post(payload, "d-1")).status).toBe(502);
    // Nothing was recorded, so ClickStack's retry is a first delivery again.
    expect(await outcomeOf(await falseAck.post(payload, "d-2"))).toBe("sent");
  });

  test("keeps counters when the recap is rejected", async () => {
    let failRecap = true;
    const system = createSystem({
      reply: ({ text }) => {
        if (text.includes("Error recap") && failRecap) {
          failRecap = false;
          return { status: 500, body: { ok: false } };
        }
        return undefined;
      },
    });
    const payload = alert({
      group: "loyal-mobile",
      rows: [withdrawalRows[0]!],
    });
    const burst = alert({
      group: "loyal-mobile",
      rows: [withdrawalRows[0]!],
      lines: 3,
    });

    expect(await outcomeOf(await system.post(payload, "d-1"))).toBe("sent");
    system.advance(MINUTE);
    expect(await outcomeOf(await system.post(payload, "d-2"))).toBe(
      "suppressed"
    );
    system.advance(MINUTE);
    expect(await outcomeOf(await system.post(burst, "d-3"))).toBe("suppressed");

    // The recap survives its own rejection and is retried on the next sweep
    // with every counter intact.
    system.advanceTo(recapAfter(START, system.config.dailyRecapAtMinutes));
    expect(system.relay.stats().dailyEvents).toBe(3);
    await system.sweep();
    // Held as a pending recap, not lost and not left to grow in the live
    // tally, so the retry re-sends the period that actually came due.
    expect(system.relay.stats().pendingRecapEvents).toBe(3);
    await system.sweep();

    const recaps = system.calls.filter((call) =>
      call.text.includes("Error recap")
    );
    expect(recaps).toHaveLength(2);
    expect(recaps[1]?.text).toContain("3 events");
    // The opening alert is the only message the period produced.
    expect(recaps[1]?.text).toContain("1 alert(s) posted");
    expect(system.relay.stats().pendingRecapEvents).toBe(0);

    verifyInvariants(system);
  });

  test("serializes concurrent deliveries for one signature", async () => {
    const system = createSystem();
    const payload = alert({ group: "loyal-mobile", rows: withdrawalRows });

    // Twenty webhooks land at the same instant. Exactly one may be posted; the
    // rest must be suppressed without recounting the same evaluation.
    const outcomes = await Promise.all(
      (
        await Promise.all(
          Array.from({ length: 20 }, (_unused, index) =>
            system.post(payload, `race-${index}`)
          )
        )
      ).map(outcomeOf)
    );

    expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "suppressed")).toHaveLength(
      19
    );
    expect(system.calls).toHaveLength(1);

    // Sweeps racing a further delivery must not double-post the recap.
    system.advanceTo(recapAfter(START, system.config.dailyRecapAtMinutes));
    await Promise.all([
      system.sweep(),
      system.sweep(),
      system.post(payload, "race-late"),
    ]);

    const recaps = system.calls.filter((call) => call.silent);
    expect(recaps).toHaveLength(1);
    // The twenty racing deliveries all reported the same evaluation range, so
    // the recap counts the events once rather than twenty times.
    expect(recaps[0]?.text).toContain("2 events");
    expect(recaps[0]?.text).toContain("1 alert(s) posted");

    verifyInvariants(system);
  });

  test("carries windows across a restart through the state snapshot", async () => {
    const before = createSystem();
    const payload = alert({ group: "loyal-mobile", rows: withdrawalRows });

    expect(await outcomeOf(await before.post(payload, "d-1"))).toBe("sent");
    before.advance(MINUTE);
    expect(await outcomeOf(await before.post(payload, "d-2"))).toBe(
      "suppressed"
    );

    // Round-tripped through JSON exactly as the state file would be.
    const snapshot = JSON.parse(
      JSON.stringify(before.relay.exportState())
    ) as PersistedState;

    const after = createSystem({
      startAt: START + MINUTE,
    });
    expect(after.relay.importState(snapshot)).toBe(1);

    // The signature is still muted, so the redeploy posts nothing at all.
    expect(await outcomeOf(await after.post(payload, "d-3"))).toBe(
      "suppressed"
    );
    expect(after.calls).toHaveLength(0);

    // The window closes silently, and the tally the snapshot carried across
    // the restart is what the scheduled recap reports.
    after.advanceTo(START + after.config.cooldownMs);
    await after.sweep();
    expect(after.calls).toHaveLength(0);

    after.advanceTo(recapAfter(START, after.config.dailyRecapAtMinutes));
    await after.sweep();
    expect(after.calls).toHaveLength(1);
    expect(after.calls[0]?.silent).toBe(true);
    expect(after.calls[0]?.text).toContain("📊 Error recap");
    // Everything the pre-restart process counted is still in the recap: the
    // events, the frequency, and the alert it posted before going down.
    expect(after.calls[0]?.text).toContain("2 events");
    expect(after.calls[0]?.text).toContain("1 alert(s) posted");
    expect(after.calls[0]?.text).toContain(
      "<b>×2</b> earn.withdrawal.prepare.failed"
    );

    verifyInvariants(after);
  });

  test("drops an expired snapshot instead of muting a live signature", async () => {
    const before = createSystem();
    const payload = alert({ group: "loyal-mobile", rows: withdrawalRows });
    await before.post(payload, "d-1");

    // The relay was down for longer than a whole window.
    const after = createSystem({
      startAt: START + 2 * before.config.cooldownMs,
    });
    expect(after.relay.importState(before.relay.exportState())).toBe(0);
    expect(await outcomeOf(await after.post(payload, "d-2"))).toBe("sent");
    expect(after.calls).toHaveLength(1);
  });
});
