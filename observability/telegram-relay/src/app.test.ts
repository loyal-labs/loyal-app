import { describe, expect, test } from "bun:test";

import {
  createRequestHandler,
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
      clickStackWebhookSecret: "test-secret",
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
    };
    expect(loadConfig(env).traceLogs).toBe(false);
    expect(loadConfig({ ...env, TRACE_LOGS: "true" }).traceLogs).toBe(true);
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
  const senderConfig = {
    telegramBotToken: "token",
    telegramChatId: "chat",
    alertColumns: defaultColumns,
  };
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
});
