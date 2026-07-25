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
 * Time is injected everywhere. Windows, the idempotency TTL and the restart
 * grace period all read the fake clock, so a code path that reached for
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
    // A fresh process is a restart, so the shipped default holds the first
    // alerts for two minutes. Tests opt into that explicitly; everything else
    // starts past it so the assertions are about the behavior under test.
    RESTART_GRACE_SECONDS: "0",
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
    digestEnabled: config.digestEnabled,
    escalationMultiplier: config.escalationMultiplier,
    restartGraceMs: config.restartGraceMs,
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

function clockString(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(11, 19);
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
      "<i>6 events · ≥2 unique wallets · muted 1h</i>"
    );
    expect(opening.text).toContain("🔴 <b>error</b> · 04:50:44 UTC");
    expect(opening.text).toContain("error_code: <code>request_failed</code>");
    expect(opening.text).toContain("wallet: <code>7XkWalletAaa</code>");
    expect(opening.text.endsWith("to=1784955060000")).toBe(true);

    // --- Repeats are counted, not posted ---------------------------------
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

    // --- Escalation breaks the window when volume explodes ---------------
    // The opening delivery reported 6 events, so ×10 is due past 60.
    system.advance(MINUTE);
    expect(
      await outcomeOf(
        await system.post(
          alert({ group: "loyal-mobile", rows: withdrawalRows, lines: 80 }),
          "d-burst"
        )
      )
    ).toBe("suppressed");

    expect(system.calls).toHaveLength(2);
    const escalation = system.calls[1]!;
    expect(escalation.silent).toBe(false);
    expect(escalation.text).toContain('📈 Escalating · Alert for "Errors"');
    expect(escalation.text).toContain(
      `98 events since ${clockString(START)} UTC`
    );
    expect(escalation.text).toContain("3 alert(s) suppressed so far");

    // --- The window closes on its exact boundary -------------------------
    const expiresAt = START + system.config.cooldownMs;

    system.advanceTo(expiresAt - 1);
    await system.sweep();
    expect(system.calls).toHaveLength(2);

    system.advanceTo(expiresAt);
    await system.sweep();
    // A second sweep at the same instant must not repeat the recap.
    await system.sweep();

    expect(system.calls).toHaveLength(3);
    const digest = system.calls[2]!;
    expect(digest.at).toBe(expiresAt);
    expect(digest.silent).toBe(true);
    expect(digest.text).toContain('🔕 Alert for "Errors" · recap of 1h');
    expect(digest.text).toContain("98 events · 3 alert(s) suppressed");
    expect(digest.text).toContain("≥2 unique wallets");
    expect(digest.text).toContain(
      `${clockString(START)} → ${clockString(START + 4 * MINUTE)} UTC`
    );
    expect(system.relay.stats().windows).toBe(0);

    // --- A fresh window after the recap ----------------------------------
    system.advance(MINUTE);
    expect(await outcomeOf(await system.post(payload, "d-4"))).toBe("sent");
    expect(system.calls).toHaveLength(4);

    // Nothing repeated inside it, so it closes without a word. Silence after
    // an alert is the signal that it happened once.
    system.advance(system.config.cooldownMs + 1);
    await system.sweep();
    expect(system.calls).toHaveLength(4);
    expect(system.relay.stats().windows).toBe(0);

    verifyInvariants(system);
  });

  test("folds a redeploy burst into one silent recap", async () => {
    const system = createSystem({ env: { RESTART_GRACE_SECONDS: "120" } });

    // ClickStack replays every live alert seconds after the relay comes up.
    expect(
      await outcomeOf(
        await system.post(
          alert({ group: "loyal-mobile", rows: withdrawalRows }),
          "r-1"
        )
      )
    ).toBe("deferred");

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
    ).toBe("deferred");

    // Still inside the grace period: nothing has been posted.
    await system.sweep();
    expect(system.calls).toHaveLength(0);

    system.advance(2 * MINUTE);
    await system.sweep();
    await system.sweep();

    expect(system.calls).toHaveLength(1);
    const recap = system.calls[0]!;
    expect(recap.silent).toBe(true);
    expect(recap.text).toContain(
      "♻️ Relay restarted · 2 alert(s) still firing"
    );
    expect(recap.text).toContain(
      "loyal-mobile — earn.withdrawal.prepare.failed"
    );
    expect(recap.text).toContain(
      "fleet rebalance vault position refresh failed"
    );

    // Both signatures stay muted afterwards rather than alerting again.
    system.advance(MINUTE);
    expect(
      await outcomeOf(
        await system.post(
          alert({ group: "loyal-mobile", rows: withdrawalRows }),
          "r-3"
        )
      )
    ).toBe("suppressed");
    expect(system.calls).toHaveLength(1);

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

  test("keeps counters when an escalation or recap is rejected", async () => {
    let failEscalation = true;
    let failDigest = true;
    const system = createSystem({
      env: { ESCALATION_MULTIPLIER: "3" },
      reply: ({ text }) => {
        if (text.includes("Escalating") && failEscalation) {
          failEscalation = false;
          return { status: 500, body: { ok: false } };
        }
        if (text.includes("recap of") && failDigest) {
          failDigest = false;
          return { status: 500, body: { ok: false } };
        }
        return undefined;
      },
    });
    const payload = alert({
      group: "loyal-mobile",
      rows: [withdrawalRows[0]!],
    });

    expect(await outcomeOf(await system.post(payload, "d-1"))).toBe("sent");
    system.advance(MINUTE);
    expect(await outcomeOf(await system.post(payload, "d-2"))).toBe(
      "suppressed"
    );

    // The escalation is due here and Telegram refuses it. The webhook must
    // still be acknowledged: the delivery is already counted, so ClickStack's
    // retry would carry the same Idempotency-Key and be answered as a
    // duplicate without ever resending.
    system.advance(MINUTE);
    expect((await system.post(payload, "d-3")).status).toBe(200);
    expect(
      system.calls.filter((call) => call.text.includes("Escalating")).length
    ).toBe(1);

    // The unused escalation slot means the next delivery retries it.
    system.advance(MINUTE);
    expect(await outcomeOf(await system.post(payload, "d-4"))).toBe(
      "suppressed"
    );
    const escalations = system.calls.filter((call) =>
      call.text.includes("Escalating")
    );
    expect(escalations).toHaveLength(2);
    expect(escalations[1]?.text).toContain("4 events since");

    // The recap survives its own rejection and is retried on the next sweep
    // with every counter intact.
    system.advance(system.config.cooldownMs);
    expect(system.relay.stats().pendingDigests).toBe(1);
    await system.sweep();
    expect(system.relay.stats().pendingDigests).toBe(1);
    await system.sweep();

    const digests = system.calls.filter((call) =>
      call.text.includes("recap of")
    );
    expect(digests).toHaveLength(2);
    expect(digests[1]?.text).toContain("4 events · 3 alert(s) suppressed");
    expect(system.relay.stats().windows).toBe(0);

    verifyInvariants(system);
  });

  test("serializes concurrent deliveries for one signature", async () => {
    // Escalation is off here so the count below is about the race alone: the
    // burst would otherwise legitimately cross the ×10 threshold as well.
    const system = createSystem({ env: { ESCALATION_MULTIPLIER: "0" } });
    const payload = alert({ group: "loyal-mobile", rows: withdrawalRows });

    // Twenty webhooks land at the same instant. Exactly one may be posted; the
    // rest must be counted rather than raced into duplicate messages.
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
    system.advance(system.config.cooldownMs);
    await Promise.all([
      system.sweep(),
      system.sweep(),
      system.post(payload, "race-late"),
    ]);

    const digests = system.calls.filter((call) => call.silent);
    expect(digests).toHaveLength(1);
    expect(digests[0]?.text).toContain("19 alert(s) suppressed");

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
      env: { RESTART_GRACE_SECONDS: "0" },
    });
    expect(after.relay.importState(snapshot)).toBe(1);

    // The signature is still muted, so the redeploy posts nothing at all.
    expect(await outcomeOf(await after.post(payload, "d-3"))).toBe(
      "suppressed"
    );
    expect(after.calls).toHaveLength(0);

    // The window still closes carrying what both processes counted.
    after.advanceTo(START + after.config.cooldownMs);
    await after.sweep();
    expect(after.calls).toHaveLength(1);
    expect(after.calls[0]?.silent).toBe(true);
    expect(after.calls[0]?.text).toContain("2 alert(s) suppressed");

    verifyInvariants(after);
  });

  test("drops an expired snapshot instead of muting a live signature", async () => {
    const before = createSystem();
    const payload = alert({ group: "loyal-mobile", rows: withdrawalRows });
    await before.post(payload, "d-1");

    // The relay was down for longer than a whole window.
    const after = createSystem({
      startAt: START + 2 * before.config.cooldownMs,
      env: { RESTART_GRACE_SECONDS: "0" },
    });
    expect(after.relay.importState(before.relay.exportState())).toBe(0);
    expect(await outcomeOf(await after.post(payload, "d-2"))).toBe("sent");
    expect(after.calls).toHaveLength(1);
  });
});
