/**
 * Replays real ClickStack error logs through the real relay and prints the
 * Telegram messages that would have been posted.
 *
 * Nothing about the relay is reimplemented here. The script only reconstructs
 * ClickStack's side of the contract — the per-minute alert evaluations and the
 * webhook bodies they produce — and then feeds them to `AlertRelay` with the
 * production analyzer, formatter and Telegram sender. The messages are captured
 * at the Telegram Bot API boundary, so what is printed is byte-for-byte what
 * the chat would have received.
 *
 * Usage:
 *   bun scripts/simulate.ts                      # last 24h
 *   bun scripts/simulate.ts --hours 168          # last week
 *   bun scripts/simulate.ts --from 2026-07-23T00:00:00Z --to 2026-07-24T00:00:00Z
 *   bun scripts/simulate.ts --cooldown 21600     # what a 6h window would look like
 *   bun scripts/simulate.ts --recap-at 09:00     # move the daily recap (UTC)
 *   bun scripts/simulate.ts --quiet              # counts only, no message bodies
 *
 * Known gap: only `ALERT` deliveries are replayed. Production also sends `OK`
 * when a condition clears, which the relay answers without posting, so the
 * message counts here are unaffected by the omission.
 *
 * ClickStack access: the script reuses the MCP endpoint configured for Claude
 * Code (`~/.claude.json` -> mcpServers.clickstack), or CLICKSTACK_MCP_URL and
 * CLICKSTACK_MCP_TOKEN when set. The token is never printed or written out.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import {
  createAlertAnalyzer,
  createTelegramSender,
  loadConfig,
  type ServerConfig,
} from "../src/app.ts";
import {
  AlertRelay,
  type AlertContext,
  type ClickStackWebhookPayload,
} from "../src/relay.ts";

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

/**
 * Mirrors the "Errors" saved search (6a5fb723dcc64beb0ded6cca) and its alert
 * (6a60c6b9dcc64beb0ded91c3). Kept next to each other because the relay's
 * ALERT_COLUMNS must stay in the same order as the `select`.
 */
const SAVED_SEARCH_WHERE = "SeverityText = 'error'";
const ALERT_GROUP_BY = "ServiceName";
const ALERT_INTERVAL_MS = MINUTE;
/**
 * The alert is configured `above` 1, but ClickStack's own body text reads
 * "meets or exceeds the threshold of 1 lines", and its history shows a fire at
 * count 1. So the effective predicate is `>=`.
 */
const ALERT_THRESHOLD = 1;
const ALERT_COLUMNS = [
  "Timestamp",
  "ServiceName",
  "SeverityText",
  "Body",
  "env",
  "flow",
  "stage",
  "error_code",
  "exception_type",
  "exception_message",
  "wallet",
];
const CARDINALITY_COLUMNS = ["wallet"];
/**
 * ClickStack truncates the row block rather than pasting an unbounded burst
 * into the message. The exact cap is not configurable and not documented, so
 * this is an assumption; it only matters for windows where one evaluation
 * matched more rows than this, and it errs the same way production does by
 * leaving `sampledRows` below `eventCount`.
 */
const DEFAULT_MAX_ROWS_PER_ALERT = 10;

interface Options {
  from: number;
  to: number;
  cooldownSeconds: number;
  maxRows: number;
  quiet: boolean;
  dailyRecapEnabled: boolean;
  dailyRecapAt: string;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  const bare = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      bare.add(name);
    }
  }

  const now = Date.now();
  const hours = Number(flags.get("hours") ?? 24);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("--hours must be a positive number");
  }

  const to = flags.has("to") ? Date.parse(flags.get("to")!) : now;
  const from = flags.has("from")
    ? Date.parse(flags.get("from")!)
    : to - hours * 3_600_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error("--from/--to must be ISO timestamps with from < to");
  }

  return {
    from,
    to,
    cooldownSeconds: Number(flags.get("cooldown") ?? 3600),
    maxRows: Number(flags.get("max-rows") ?? DEFAULT_MAX_ROWS_PER_ALERT),
    quiet: bare.has("quiet"),
    dailyRecapEnabled: !bare.has("no-recap"),
    dailyRecapAt: flags.get("recap-at") ?? "06:00",
  };
}

// --------------------------------------------------------------------------
// ClickStack access, over the same MCP endpoint Claude Code uses.
// --------------------------------------------------------------------------

interface McpTarget {
  url: string;
  token: string;
}

async function resolveMcpTarget(): Promise<McpTarget> {
  const url = process.env.CLICKSTACK_MCP_URL;
  const token = process.env.CLICKSTACK_MCP_TOKEN;
  if (url && token) {
    return { url, token };
  }

  const configPath = join(homedir(), ".claude.json");
  const raw = await Bun.file(configPath)
    .text()
    .catch(() => "");
  if (!raw) {
    throw new Error(
      `No ClickStack credentials: set CLICKSTACK_MCP_URL and CLICKSTACK_MCP_TOKEN, or configure the clickstack MCP server in ${configPath}`
    );
  }

  const config = JSON.parse(raw) as {
    mcpServers?: Record<
      string,
      { url?: string; headers?: Record<string, string> }
    >;
  };
  const server = config.mcpServers?.clickstack;
  const authorization = server?.headers?.Authorization ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!server?.url || !bearer) {
    throw new Error(
      `clickstack MCP server is not configured with a url and Authorization header in ${configPath}`
    );
  }

  return { url: server.url, token: bearer };
}

/** Minimal streamable-HTTP MCP client: initialize, then one tools/call. */
class McpClient {
  private sessionId = "";
  private nextId = 1;

  constructor(private readonly target: McpTarget) {}

  async connect(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "telegram-relay-simulator", version: "1.0.0" },
    });
    await this.notify("notifications/initialized");
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as {
      isError?: boolean;
      content?: { type: string; text?: string }[];
    };

    const text = result.content?.find((part) => part.type === "text")?.text;
    if (result.isError) {
      throw new Error(`MCP tool ${name} failed: ${text ?? "unknown error"}`);
    }
    if (!text) {
      throw new Error(`MCP tool ${name} returned no text content`);
    }
    return JSON.parse(text);
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.target.token}`,
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
    };
  }

  private async notify(method: string): Promise<void> {
    await fetch(this.target.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method, params: {} }),
    });
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const response = await fetch(this.target.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params,
      }),
    });

    const session = response.headers.get("mcp-session-id");
    if (session) {
      this.sessionId = session;
    }

    const text = await response.text();
    if (!response.ok) {
      // Never echo the body verbatim: it can contain the endpoint's own error
      // payload, and the request carried a bearer token.
      throw new Error(`MCP ${method} failed with HTTP ${response.status}`);
    }

    const message = parseJsonRpc(text);
    if (message.error) {
      throw new Error(`MCP ${method} error: ${message.error.message}`);
    }
    return message.result;
  }
}

interface JsonRpcMessage {
  result?: unknown;
  error?: { message: string };
}

/** The endpoint answers with either plain JSON or a one-event SSE stream. */
function parseJsonRpc(body: string): JsonRpcMessage {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonRpcMessage;
  }

  for (const line of trimmed.split("\n")) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") {
        return JSON.parse(data) as JsonRpcMessage;
      }
    }
  }

  throw new Error("Could not parse MCP response");
}

interface LogRow {
  tsMs: number;
  fields: string[];
}

/** A minute is the alert's own resolution; below it there is nothing to split. */
const MIN_SLICE_MS = MINUTE;

/**
 * Fetches a range, halving it whenever the endpoint trims the response. The
 * alternative — one wide query — comes back as a silent sample and would make
 * every number downstream wrong in the safe-looking direction.
 *
 * Slices are half-open on purpose, and the query bounds `Timestamp` explicitly
 * rather than through `$__timeFilter_ms`, whose upper bound is inclusive: with
 * an inclusive filter every split would duplicate the rows landing exactly on
 * the boundary.
 */
async function fetchSlice(
  client: McpClient,
  connectionId: string,
  sql: string,
  from: number,
  to: number
): Promise<Record<string, string>[]> {
  const response = (await client.callTool("clickstack_sql", {
    connectionId,
    sql,
    startTime: new Date(from).toISOString(),
    endTime: new Date(to).toISOString(),
  })) as SqlResponse;

  const data = response.result?.data ?? [];
  const reported = response.result?.rows ?? data.length;
  const trimmed =
    response.result?.__hdx_trimmed === true || reported > data.length;

  if (!trimmed) {
    return data;
  }

  if (to - from <= MIN_SLICE_MS) {
    throw new Error(
      `ClickStack trimmed a single-minute slice at ${new Date(
        from
      ).toISOString()} (${reported} rows). Cannot fetch it completely.`
    );
  }

  const middle = from + Math.floor((to - from) / 2);
  const [left, right] = [
    await fetchSlice(client, connectionId, sql, from, middle),
    await fetchSlice(client, connectionId, sql, middle, to),
  ];
  return [...left, ...right];
}

interface SqlResponse {
  result?: {
    data?: Record<string, string>[];
    rows?: number;
    /**
     * The MCP endpoint trims large results to fit an agent's context and says
     * so only in this flag. Left unchecked it silently turns a week of logs
     * into an unrepresentative sample, which is the one thing a reality check
     * must never do.
     */
    __hdx_trimmed?: boolean;
  };
}

async function fetchErrorRows(options: Options): Promise<LogRow[]> {
  const client = new McpClient(await resolveMcpTarget());
  await client.connect();

  const sources = (await client.callTool("clickstack_list_sources", {})) as {
    connections?: { id: string }[];
  };
  const connectionId = sources.connections?.[0]?.id;
  if (!connectionId) {
    throw new Error("No ClickHouse connection exposed by the MCP endpoint");
  }

  const sql = `
    SELECT
      toUnixTimestamp64Milli(Timestamp) AS ts_ms,
      formatDateTime(toDateTime(Timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS ts,
      ServiceName,
      SeverityText,
      Body,
      ResourceAttributes['deployment.environment.name'] AS env,
      LogAttributes['loyal.flow.name'] AS flow,
      LogAttributes['loyal.flow.stage'] AS stage,
      LogAttributes['loyal.error.code'] AS error_code,
      LogAttributes['exception.type'] AS exception_type,
      LogAttributes['exception.message'] AS exception_message,
      LogAttributes['loyal.wallet.address'] AS wallet
    FROM otel_logs
    WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
      AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
      AND ${SAVED_SEARCH_WHERE}
    ORDER BY Timestamp ASC
    LIMIT 50000
  `;

  const data = await fetchSlice(
    client,
    connectionId,
    sql,
    options.from,
    options.to
  );

  return data.map((row) => ({
    tsMs: Number(row.ts_ms),
    fields: [
      String(row.ts ?? ""),
      String(row.ServiceName ?? ""),
      String(row.SeverityText ?? ""),
      String(row.Body ?? ""),
      String(row.env ?? ""),
      String(row.flow ?? ""),
      String(row.stage ?? ""),
      String(row.error_code ?? ""),
      String(row.exception_type ?? ""),
      String(row.exception_message ?? ""),
      String(row.wallet ?? ""),
    ],
  }));
}

// --------------------------------------------------------------------------
// ClickStack's alerting side, reconstructed.
// --------------------------------------------------------------------------

interface Evaluation {
  /** When ClickStack would POST: evaluations run at the end of their range. */
  deliveredAt: number;
  rangeStart: number;
  rangeEnd: number;
  group: string;
  /** The rows pasted into the body, capped the way ClickStack caps them. */
  rows: LogRow[];
  /** Every matched line, including the ones the body did not carry. */
  matchedLines: number;
}

function buildEvaluations(rows: LogRow[], options: Options): Evaluation[] {
  const groups = new Map<string, LogRow[]>();
  for (const row of rows) {
    const rangeStart =
      Math.floor(row.tsMs / ALERT_INTERVAL_MS) * ALERT_INTERVAL_MS;
    const group = row.fields[ALERT_COLUMNS.indexOf(ALERT_GROUP_BY)] ?? "";
    const key = `${rangeStart} ${group}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const evaluations: Evaluation[] = [];
  for (const [key, bucket] of groups) {
    if (bucket.length < ALERT_THRESHOLD) {
      continue;
    }
    const [rangeStartRaw, group] = key.split(" ");
    const rangeStart = Number(rangeStartRaw);
    evaluations.push({
      deliveredAt: rangeStart + ALERT_INTERVAL_MS,
      rangeStart,
      rangeEnd: rangeStart + ALERT_INTERVAL_MS,
      group: group ?? "",
      rows: bucket.slice(0, Math.max(options.maxRows, 1)),
      matchedLines: bucket.length,
    });
  }

  // Deterministic ordering, so a rerun of the same range is comparable.
  return evaluations.sort(
    (left, right) =>
      left.deliveredAt - right.deliveredAt ||
      left.group.localeCompare(right.group)
  );
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** ClickStack renders its range as "Jul 25 4:50:00 AM", not as ISO. */
function formatRange(start: number, end: number): string {
  const render = (value: number) => {
    const date = new Date(value);
    const month = date.toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    const clock = date.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "UTC",
    });
    return `${month} ${date.getUTCDate()} ${clock}`;
  };
  return `Time Range (UTC): [${render(start)} - ${render(end)})`;
}

/**
 * ClickStack's `eventId` is a stable hash per alert and group: production logs
 * show one id repeated across every delivery of an incident, including the
 * `OK` that closes it. Making it unique per delivery here would change what is
 * being simulated — the relay falls back to `eventId` for its dedup key when a
 * row block will not parse, and a per-delivery id would open a fresh window
 * every minute on exactly the payloads that are hardest to read.
 */
function eventIdFor(group: string): string {
  let hash = 0x811c9dc5;
  for (const character of `Errors:${group}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(5);
}

/** A webhook body shaped exactly like ClickStack's generic destination. */
function toWebhookPayload(evaluation: Evaluation): ClickStackWebhookPayload {
  const matchedLines = evaluation.matchedLines;
  const csv = evaluation.rows.map((row) => row.fields.map(csvField).join(","));

  return {
    eventId: eventIdFor(evaluation.group),
    state: "ALERT",
    title: `🚨 Alert for "Errors" - ${matchedLines} lines found`,
    body: [
      `Group: "${ALERT_GROUP_BY}:${evaluation.group}"`,
      `${matchedLines} lines found, which meets or exceeds the threshold of ${ALERT_THRESHOLD} lines`,
      formatRange(evaluation.rangeStart, evaluation.rangeEnd),
      "",
      "```",
      ...csv,
      "```",
    ].join("\n"),
    link: `https://loyal-clickstack.onrender.com/search/6a5fb723dcc64beb0ded6cca?from=${evaluation.rangeStart}&to=${evaluation.rangeEnd}`,
    startTime: evaluation.rangeStart,
    endTime: evaluation.rangeEnd,
  };
}

// --------------------------------------------------------------------------
// The relay, wired exactly as production wires it.
// --------------------------------------------------------------------------

interface CapturedMessage {
  at: number;
  kind: string;
  silent: boolean;
  text: string;
}

function simulationConfig(options: Options): ServerConfig {
  return loadConfig({
    CLICKSTACK_WEBHOOK_SECRET: "simulation",
    TELEGRAM_BOT_TOKEN: "0:simulation",
    TELEGRAM_CHAT_ID: "-100000000000",
    ALERT_COLUMNS: ALERT_COLUMNS.join(","),
    CARDINALITY_COLUMNS: CARDINALITY_COLUMNS.join(","),
    COOLDOWN_SECONDS: String(options.cooldownSeconds),
    DAILY_RECAP_ENABLED: String(options.dailyRecapEnabled),
    DAILY_RECAP_AT: options.dailyRecapAt,
  });
}

async function simulate(
  evaluations: Evaluation[],
  options: Options
): Promise<CapturedMessage[]> {
  const config = simulationConfig(options);
  const messages: CapturedMessage[] = [];
  let clock = evaluations[0]?.deliveredAt ?? options.from;
  let pendingKind = "new";

  // Capture at the Telegram Bot API boundary: everything above this line is
  // the production code path, including the HTML formatting.
  const sender = createTelegramSender(
    config,
    async (_url, init) => {
      const body = JSON.parse(String(init.body)) as {
        text: string;
        disable_notification?: boolean;
      };
      messages.push({
        at: clock,
        kind: pendingKind,
        silent: Boolean(body.disable_notification),
        text: body.text,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async () => {}
  );

  const trackingSender = async (
    payload: ClickStackWebhookPayload,
    context: AlertContext
  ) => {
    pendingKind = context.kind;
    await sender(payload, context);
  };

  const relay = new AlertRelay(trackingSender, {
    cooldownMs: config.cooldownMs,
    idempotencyTtlMs: config.idempotencyTtlMs,
    maxCacheEntries: config.maxCacheEntries,
    dailyRecapEnabled: config.dailyRecapEnabled,
    dailyRecapAtMinutes: config.dailyRecapAtMinutes,
    analyze: createAlertAnalyzer(config),
    now: () => clock,
    startedAt: clock,
  });

  let sweptThrough = clock;
  for (const evaluation of evaluations) {
    // Advance a minute at a time so the 60s sweep fires exactly as often as
    // the deployed timer does, not just when a webhook happens to arrive.
    while (sweptThrough + MINUTE <= evaluation.deliveredAt) {
      sweptThrough += MINUTE;
      clock = sweptThrough;
      await relay.sweep(clock);
    }

    clock = evaluation.deliveredAt;
    // The idempotency key is per delivery, unlike `eventId`, so a repeated
    // range is recognised as a retry rather than as a duplicate incident.
    await relay.handle(
      toWebhookPayload(evaluation),
      `sim-${evaluation.rangeStart}-${evaluation.group}`
    );
  }

  // Drain: run past the last window and on to the next scheduled recap, so
  // the final period is reported instead of being cut off mid-tally.
  const drainUntil = clock + config.cooldownMs + DAY_MS + MINUTE;
  while (clock < drainUntil) {
    clock += MINUTE;
    await relay.sweep(clock);
  }

  return messages;
}

// --------------------------------------------------------------------------
// Reporting.
// --------------------------------------------------------------------------

function utc(value: number): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 19);
}

function report(
  messages: CapturedMessage[],
  evaluations: Evaluation[],
  options: Options
): void {
  const days = (options.to - options.from) / 86_400_000;
  const byKind = new Map<string, number>();
  for (const message of messages) {
    byKind.set(message.kind, (byKind.get(message.kind) ?? 0) + 1);
  }

  console.log("=".repeat(72));
  console.log(
    `Window   ${utc(options.from)} .. ${utc(options.to)} UTC  (${days.toFixed(
      2
    )}d)`
  );
  console.log(
    `Settings cooldown=${options.cooldownSeconds}s recap=${
      options.dailyRecapEnabled ? `${options.dailyRecapAt} UTC` : "off"
    }`
  );
  console.log("=".repeat(72));

  if (!options.quiet) {
    for (const message of messages) {
      console.log("");
      console.log(
        `--- ${utc(message.at)} UTC  [${message.kind}]${
          message.silent ? " (silent)" : ""
        }`
      );
      console.log(message.text);
    }
    console.log("");
  }

  console.log("-".repeat(72));
  console.log(`Webhook deliveries in : ${evaluations.length}`);
  console.log(`Telegram messages out : ${messages.length}`);
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(20)}${count}`);
  }
  const silent = messages.filter((message) => message.silent).length;
  console.log(`  ${"(of those silent)".padEnd(20)}${silent}`);
  if (days >= 1) {
    console.log(
      `Messages per day      : ${(messages.length / days).toFixed(1)}`
    );
  }
  if (evaluations.length > 0) {
    const ratio = (1 - messages.length / evaluations.length) * 100;
    console.log(`Noise reduction       : ${ratio.toFixed(1)}%`);
  }
  console.log("-".repeat(72));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rows = await fetchErrorRows(options);
  const evaluations = buildEvaluations(rows, options);

  console.log(
    `Fetched ${rows.length} error rows -> ${evaluations.length} alert evaluations`
  );
  const messages = await simulate(evaluations, options);
  report(messages, evaluations, options);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
