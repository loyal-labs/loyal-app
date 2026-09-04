import { describe, expect, test } from "bun:test";

import {
  createRequestHandler,
  createFanoutSender,
  createSlackSender,
  createTelegramSender,
  formatPlainTelegramMessage,
  formatTelegramMessage,
  loadConfig,
  validatePayload,
} from "./app.ts";
import {
  type AlertContext,
  AlertRelay,
  type ClickStackWebhookPayload,
} from "./relay.ts";

const payload: ClickStackWebhookPayload = {
  eventId: "alert-errors-service-loyal-mobile",
  state: "ALERT",
  title: "Alert for Errors",
  body: "3 lines found",
  link: "https://clickstack.example/search/1",
  startTime: 1,
  endTime: 2,
};

const defaultColumns = ["Timestamp", "ServiceName", "SeverityText", "Body"];

function format(
  item: ClickStackWebhookPayload,
  alertColumns: string[] = defaultColumns
) {
  return formatTelegramMessage(item, { alertColumns });
}

/**
 * Senders are built from a real `loadConfig` result, the way `index.ts` builds
 * them: `redactLogText` is branded and its constructor is private, so this is
 * also the only way a test can get one. Tests that care about redaction pass
 * their fake credentials as env, and the redactor covers all of them.
 */
function testConfig(env: Record<string, string> = {}) {
  return loadConfig({
    CLICKSTACK_WEBHOOK_SECRET: "test-webhook-secret",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_CHAT_ID: "chat",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/test",
    ...env,
  });
}

type LogLine = Record<string, unknown>;

/**
 * The delivered-text logs are the feature, not a side effect, so the tests read
 * them the way an operator reads Render logs: as parsed JSON lines on stdout.
 */
function captureInfoLogs() {
  const original = console.info;
  const lines: LogLine[] = [];
  console.info = (...args: unknown[]) => {
    try {
      lines.push(JSON.parse(String(args[0])) as LogLine);
    } catch {
      // Non-JSON output is not something this relay emits; ignore it rather
      // than fail a test on an unrelated log line.
    }
  };

  return {
    restore: () => {
      console.info = original;
    },
    all: (event: string) => lines.filter((line) => line.event === event),
    find: (event: string) => lines.find((line) => line.event === event),
  };
}

function createTestHandler() {
  const sent: ClickStackWebhookPayload[] = [];
  const relay = new AlertRelay(
    async (item) => {
      sent.push(item);
    },
    {
      cooldownMs: 3_600_000,
      idempotencyTtlMs: 86_400_000,
      maxCacheEntries: 100,
      now: () => 1_000,
    }
  );
  return {
    sent,
    handler: createRequestHandler(relay, {
      credentials: testConfig({ CLICKSTACK_WEBHOOK_SECRET: "test-secret" })
        .credentials,
    }),
  };
}

describe("HTTP handler", () => {
  test("rejects an invalid Bearer token", async () => {
    const { handler } = createTestHandler();
    const response = await handler(
      new Request("http://localhost/webhooks/clickstack", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong",
          "Idempotency-Key": "delivery-1",
        },
        body: JSON.stringify(payload),
      })
    );

    expect(response.status).toBe(401);
  });

  test("requires Idempotency-Key", async () => {
    const { handler } = createTestHandler();
    const response = await handler(
      new Request("http://localhost/webhooks/clickstack", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
        body: JSON.stringify(payload),
      })
    );

    expect(response.status).toBe(400);
  });

  test("returns 2xx for a suppressed alert", async () => {
    const { handler, sent } = createTestHandler();
    const send = (idempotencyKey: string) =>
      handler(
        new Request("http://localhost/webhooks/clickstack", {
          method: "POST",
          headers: {
            Authorization: "Bearer test-secret",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        })
      );

    expect((await send("delivery-1")).status).toBe(200);
    const suppressed = await send("delivery-2");
    expect(suppressed.status).toBe(200);
    expect(await suppressed.json()).toEqual({
      ok: true,
      outcome: "suppressed",
    });
    expect(sent).toHaveLength(1);
  });
});

describe("payload and formatting", () => {
  test("validates ClickStack payloads", () => {
    expect(validatePayload(payload)).toEqual({ ok: true, payload });
    expect(validatePayload({ ...payload, state: "DISABLED" })).toEqual({
      ok: true,
      payload: { ...payload, state: "DISABLED" },
    });
    expect(validatePayload({ ...payload, state: 1 }).ok).toBe(false);
  });

  test("reports field-level validation reasons without payload values", () => {
    expect(
      validatePayload({
        ...payload,
        startTime: "1",
        endTime: "2",
      })
    ).toEqual({
      ok: false,
      issues: [
        "startTime must be a finite number (received string)",
        "endTime must be a finite number (received string)",
      ],
    });
  });

  test("rejects payloads that format into an empty Telegram message", () => {
    expect(
      validatePayload({
        ...payload,
        title: "   ",
        body: "",
        link: "",
      })
    ).toEqual({
      ok: false,
      issues: ["title must contain non-whitespace text"],
    });
  });

  test("accepts arbitrary ClickStack state strings", () => {
    expect(validatePayload({ ...payload, state: "INSUFFICIENT_DATA" })).toEqual(
      {
        ok: true,
        payload: { ...payload, state: "INSUFFICIENT_DATA" },
      }
    );
  });

  test("keeps trace logging disabled by default", () => {
    const env = {
      CLICKSTACK_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/test",
    };
    expect(loadConfig(env).traceLogs).toBe(false);
    expect(loadConfig({ ...env, TRACE_LOGS: "true" }).traceLogs).toBe(true);
  });

  test("builds one log redactor covering every credential it read", () => {
    // The senders require this redactor, so this is the only place a credential
    // can be left out of the redaction — adding one to ServerConfig without
    // adding it here is the regression this guards.
    const secret = "clickstack-bearer-secret-value";
    const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const webhook =
      "https://hooks.slack.com/services/T00000/B00000/abcdef123456";
    const config = loadConfig({
      CLICKSTACK_WEBHOOK_SECRET: secret,
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_CHAT_ID: "chat",
      SLACK_WEBHOOK_URL: webhook,
    });

    const redacted = config.credentials.redactLogText(
      `secret=${secret} token=${token} webhook=${webhook}`
    );

    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain("abcdef123456");
  });

  test("keeps Telegram messages within the API limit", () => {
    const message = format({ ...payload, body: "x".repeat(10_000) });
    expect(message.text.length).toBeLessThanOrEqual(4096);
    expect(message.text.endsWith(payload.link)).toBe(true);
  });

  test("never emits a partially truncated link", () => {
    const link = `https://clickstack.example/search?q=${"a".repeat(4000)}`;
    const text = formatPlainTelegramMessage({
      ...payload,
      title: "Errors in loyal-frontend",
      body: "x".repeat(2000),
      link,
    });

    expect(text.length).toBeLessThanOrEqual(4096);
    // Either the whole link survives or none of it does; a clipped URL looks
    // clickable and resolves nowhere.
    expect(text.includes(link) || !text.includes("https://")).toBe(true);
  });

  test("never truncates a message onto a split surrogate pair", () => {
    const message = format({ ...payload, body: "😀".repeat(5_000) });
    expect(message.text.length).toBeLessThanOrEqual(4096);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(message.text)).toBe(false);
  });

  test("reads the default alert columns and rejects an empty override", () => {
    const env = {
      CLICKSTACK_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/test",
    };
    expect(loadConfig(env).alertColumns).toEqual([
      "Timestamp",
      "ServiceName",
      "SeverityText",
      "Body",
    ]);
    expect(
      loadConfig({ ...env, ALERT_COLUMNS: "Timestamp, flow ,stage" })
        .alertColumns
    ).toEqual(["Timestamp", "flow", "stage"]);
    expect(() => loadConfig({ ...env, ALERT_COLUMNS: " , ," })).toThrow(
      "ALERT_COLUMNS"
    );
  });
});

describe("pretty alert formatting", () => {
  const alertBody = [
    'Group: "ServiceName:loyal-mobile"',
    "2 lines found, which meets or exceeds the threshold of 1 lines",
    "Time Range (UTC): [Jul 21 7:15:00 PM - Jul 21 7:20:00 PM)",
    "",
    "```",
    '"2026-07-21T19:15:10.807000000Z","loyal-mobile","prod","earn.withdrawal","prepare",""',
    '"2026-07-21T19:15:13.658000000Z","loyal-mobile","prod","earn.withdrawal","wallet_submit_confirm","unexpected_error"',
    "```",
  ].join("\n");
  const columns = [
    "Timestamp",
    "ServiceName",
    "env",
    "flow",
    "stage",
    "error_code",
  ];

  test("labels CSV fields and drops empty ones", () => {
    const message = format({ ...payload, body: alertBody }, columns);

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("19:15:13 UTC");
    expect(message.text).toContain("flow: <code>earn.withdrawal</code>");
    expect(message.text).toContain("error_code: <code>unexpected_error</code>");
    // The first row has an empty error_code, so it must not render a label.
    expect(message.text.match(/error_code:/g)).toHaveLength(1);
    expect(message.text.endsWith(payload.link)).toBe(true);
  });

  test("escapes HTML so a log body cannot break the message", () => {
    const message = format(
      {
        ...payload,
        body: ["```", '"2026-07-21T19:15:10.807Z","<b>svc</b>"', "```"].join(
          "\n"
        ),
      },
      ["Timestamp", "ServiceName"]
    );

    expect(message.text).toContain("&lt;b&gt;svc&lt;/b&gt;");
    expect(message.text).not.toContain("<b>svc</b>");
  });

  test("falls back to raw text when the columns do not match the payload", () => {
    const message = format({ ...payload, body: alertBody }, [
      "Timestamp",
      "ServiceName",
    ]);

    expect(message.parseMode).toBeUndefined();
    expect(message.text).toContain('"loyal-mobile"');
  });

  test("falls back to raw text when there is no CSV block", () => {
    const message = format({ ...payload, body: "3 lines found" }, columns);

    expect(message.parseMode).toBeUndefined();
    expect(message.text).toBe(
      `${payload.title}\n\n3 lines found\n\n${payload.link}`
    );
  });

  test("keeps a formatted burst inside the Telegram limit", () => {
    const rows = Array.from(
      { length: 200 },
      (_, index) =>
        `"2026-07-21T19:15:10.807000000Z","loyal-mobile","prod","earn.withdrawal","stage-${index}","${"e".repeat(
          200
        )}"`
    );
    const message = format(
      { ...payload, body: ["```", ...rows, "```"].join("\n") },
      columns
    );

    expect(message.text.length).toBeLessThanOrEqual(4096);
    expect(message.text).toContain("more row(s)");
    expect(message.text.endsWith(payload.link)).toBe(true);
  });

  test("rejects non-integer numeric configuration", () => {
    const env = {
      CLICKSTACK_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat",
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/test",
    };
    expect(() => loadConfig({ ...env, PORT: "0x10" })).toThrow(
      "PORT must be a positive integer"
    );
    expect(() => loadConfig({ ...env, PORT: "1e3" })).toThrow(
      "PORT must be a positive integer"
    );
    expect(loadConfig({ ...env, PORT: "8080" }).port).toBe(8080);
  });
});

describe("Telegram sender", () => {
  const senderConfig = testConfig();
  const newAlert: AlertContext = { kind: "new", silent: false };
  const formattedPayload: ClickStackWebhookPayload = {
    ...payload,
    body: [
      "```",
      '"2026-07-21T19:15:10.807Z","loyal-mobile","error","boom"',
      "```",
    ].join("\n"),
  };

  test("waits out a short retry_after and retries once", async () => {
    const slept: number[] = [];
    let attempts = 0;
    const send = createTelegramSender(
      senderConfig,
      async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(
            JSON.stringify({ ok: false, parameters: { retry_after: 2 } }),
            { status: 429 }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      async (ms) => {
        slept.push(ms);
      }
    );

    await send(payload, newAlert);
    expect(attempts).toBe(2);
    expect(slept).toEqual([2000]);
  });

  test("gives the retry back to ClickStack when retry_after is long", async () => {
    let attempts = 0;
    const send = createTelegramSender(
      senderConfig,
      async () => {
        attempts += 1;
        return new Response(
          JSON.stringify({ ok: false, parameters: { retry_after: 120 } }),
          { status: 429 }
        );
      },
      async () => undefined
    );

    await expect(send(payload, newAlert)).rejects.toThrow("rate limited");
    expect(attempts).toBe(1);
  });

  test("surfaces a non-rate-limit Telegram failure", async () => {
    const send = createTelegramSender(
      senderConfig,
      async () =>
        new Response(
          JSON.stringify({ ok: false, description: "chat not found" }),
          {
            status: 400,
          }
        )
    );

    await expect(send(payload, newAlert)).rejects.toThrow("HTTP 400");
  });

  test("rejects an HTTP 200 that Telegram did not acknowledge", async () => {
    const send = createTelegramSender(
      senderConfig,
      async () =>
        new Response(
          JSON.stringify({ ok: false, description: "chat not found" }),
          { status: 200 }
        )
    );

    // Accepting this would record a cooldown and acknowledge ClickStack,
    // dropping the alert for a full cooldown window.
    await expect(send(payload, newAlert)).rejects.toThrow(
      "did not acknowledge"
    );
  });

  test("resends unformatted text when Telegram rejects the HTML entities", async () => {
    const bodies: Record<string, unknown>[] = [];
    const send = createTelegramSender(senderConfig, async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({ ok: false, description: "can't parse entities" }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await send(formattedPayload, newAlert);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.parse_mode).toBe("HTML");
    expect(bodies[1]?.parse_mode).toBeUndefined();
    expect(bodies[1]?.text).toContain('"loyal-mobile"');
  });

  test("logs the delivered text, redacted, before posting it", async () => {
    const logs = captureInfoLogs();
    const send = createTelegramSender(
      testConfig({ TELEGRAM_BOT_TOKEN: "123456:AAAA-token" }),
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    try {
      await send(
        {
          ...formattedPayload,
          body: [
            "```",
            '"2026-07-21T19:15:10.807Z","loyal-mobile","error","leaked bot123456:AAAA-token"',
            "```",
          ].join("\n"),
        },
        { kind: "new", silent: false }
      );
    } finally {
      logs.restore();
    }

    const line = logs.find("alert_message_outgoing");
    expect(line?.destination).toBe("telegram");
    expect(line?.eventId).toBe(payload.eventId);
    expect(line?.kind).toBe("new");
    expect(line?.silent).toBe(false);
    expect(line?.parseMode).toBe("HTML");
    expect(String(line?.text)).toContain("Alert for Errors");
    expect(String(line?.text)).toContain("bot<redacted>");
    expect(String(line?.text)).not.toContain("AAAA-token");
    expect(line?.chars).toBe(String(line?.text).length);
    expect(line?.truncated).toBeUndefined();
  });

  test("redacts a bot token an alerted service logged without the URL prefix", async () => {
    const logs = captureInfoLogs();
    // The shape of a real token, carried in the alert text with no `bot` in
    // front of it: the URL-shaped redaction does not see this one.
    const leaked = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const send = createTelegramSender(
      senderConfig,
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    try {
      await send(
        {
          ...payload,
          body: [
            "```",
            `"2026-07-21T19:15:10.807Z","loyal-mobile","error","TELEGRAM_BOT_TOKEN=${leaked}"`,
            "```",
          ].join("\n"),
        },
        newAlert
      );
    } finally {
      logs.restore();
    }

    const text = String(logs.find("alert_message_outgoing")?.text);
    expect(text).not.toContain(leaked);
    expect(text).not.toContain("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw");
    expect(text).toContain("TELEGRAM_BOT_TOKEN=<redacted>");
  });

  test("redacts configured secrets by value, whatever shape they have", async () => {
    const logs = captureInfoLogs();
    const token = "unshaped-but-still-a-secret-value";
    const webhookSecret = "clickstack-bearer-secret-value";
    const send = createTelegramSender(
      testConfig({
        TELEGRAM_BOT_TOKEN: token,
        CLICKSTACK_WEBHOOK_SECRET: webhookSecret,
      }),
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    try {
      await send(
        { ...payload, title: `Errors ${token} ${webhookSecret}` },
        newAlert
      );
    } finally {
      logs.restore();
    }

    const text = String(logs.find("alert_message_outgoing")?.text);
    expect(text).not.toContain(token);
    expect(text).not.toContain(webhookSecret);
    expect(text).toContain("<redacted>");
  });

  test("logs the text of a send Telegram rejects, and of its fallback", async () => {
    const logs = captureInfoLogs();
    let attempts = 0;
    const send = createTelegramSender(senderConfig, async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(
          JSON.stringify({ ok: false, description: "can't parse entities" }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    try {
      await send(formattedPayload, newAlert);
    } finally {
      logs.restore();
    }

    const lines = logs.all("alert_message_outgoing");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.parseMode).toBe("HTML");
    expect(lines[0]?.fallback).toBeUndefined();
    expect(lines[1]?.fallback).toBe(true);
    expect(String(lines[1]?.text)).toContain('"loyal-mobile"');
  });

  test("logs a failed send's text even though nothing was delivered", async () => {
    const logs = captureInfoLogs();
    const send = createTelegramSender(
      senderConfig,
      async () =>
        new Response(JSON.stringify({ ok: false, description: "nope" }), {
          status: 500,
        })
    );

    try {
      await expect(send(payload, newAlert)).rejects.toThrow("HTTP 500");
    } finally {
      logs.restore();
    }

    expect(logs.all("alert_message_outgoing")).toHaveLength(1);
  });
});

describe("Slack sender and fan-out", () => {
  const newAlert: AlertContext = { kind: "new", silent: false };

  test("posts the formatted alert to the configured Slack webhook", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const send = createSlackSender(testConfig(), async (url, init) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return new Response("ok", { status: 200 });
    });

    await send(payload, newAlert);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://hooks.slack.com/services/test");
    expect(requests[0]?.body.text).toContain("Alert for Errors");
    expect(requests[0]?.body.text).toContain(payload.link);
  });

  test("redacts the other destination's credentials from its own log line", async () => {
    const logs = captureInfoLogs();
    // Neither value is redactable by shape, and both senders log the same text:
    // whatever one sender hides, the other must hide too.
    const telegramToken = "unshaped-but-still-a-secret-value";
    const webhookSecret = "clickstack-bearer-secret-value";
    const send = createSlackSender(
      // The Slack sender never touches the Telegram token, but it logs the
      // same text, so its redactor has to cover it.
      testConfig({
        TELEGRAM_BOT_TOKEN: telegramToken,
        CLICKSTACK_WEBHOOK_SECRET: webhookSecret,
      }),
      async () => new Response("ok", { status: 200 })
    );

    try {
      await send(
        { ...payload, title: `Errors ${telegramToken} ${webhookSecret}` },
        newAlert
      );
    } finally {
      logs.restore();
    }

    const text = String(logs.find("alert_message_outgoing")?.text);
    expect(text).not.toContain(telegramToken);
    expect(text).not.toContain(webhookSecret);
  });

  test("logs the Slack rendering rather than the Telegram HTML", async () => {
    const logs = captureInfoLogs();
    const send = createSlackSender(
      testConfig(),
      async () => new Response("ok", { status: 200 })
    );

    const rowPayload: ClickStackWebhookPayload = {
      ...payload,
      body: [
        "```",
        '"2026-07-21T19:15:10.807Z","loyal-mobile","error","boom"',
        "```",
      ].join("\n"),
    };

    try {
      await send(rowPayload, newAlert);
    } finally {
      logs.restore();
    }

    const line = logs.find("alert_message_outgoing");
    expect(line?.destination).toBe("slack");
    expect(line?.parseMode).toBeUndefined();
    expect(String(line?.text)).toContain("*🚨 Alert for Errors*");
    expect(String(line?.text)).not.toContain("<b>");
  });

  test("does not acknowledge fan-out when either destination fails", async () => {
    const destinations: string[] = [];
    const send = createFanoutSender([
      async () => {
        destinations.push("telegram");
      },
      async () => {
        destinations.push("slack");
        throw new Error("Slack returned HTTP 500");
      },
    ]);

    await expect(send(payload, newAlert)).rejects.toThrow("destination(s) 2");
    expect(destinations).toEqual(["telegram", "slack"]);
  });
});
