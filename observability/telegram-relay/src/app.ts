import { timingSafeEqual } from "node:crypto";

import {
  analyzeAlert,
  DEFAULT_ALERT_COLUMNS,
  type FormattedMessage,
  formatPlainTelegramMessage,
  formatTelegramMessage,
} from "./format.ts";
import { redactBotToken } from "./redact.ts";
import {
  type AlertAnalyzer,
  AlertRelay,
  type ClickStackWebhookPayload,
  type TelegramSender,
} from "./relay.ts";

export { formatPlainTelegramMessage, formatTelegramMessage } from "./format.ts";
export { redactBotToken } from "./redact.ts";

const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;
/** Longest `retry_after` we absorb in-process before handing the retry back. */
const TELEGRAM_MAX_RETRY_AFTER_MS = 5_000;
/**
 * Well under the default MAX_BODY_BYTES so that a payload this validator
 * accepts cannot be rejected by Bun's byte-counted body cap first (multi-byte
 * text costs 2-4 bytes per character). Anything past the Telegram limit is
 * truncated for delivery anyway.
 */
const MAX_BODY_FIELD_LENGTH = 8192;

export interface ServerConfig {
  host: string;
  port: number;
  clickStackWebhookSecret: string;
  telegramBotToken: string;
  telegramChatId: string;
  cooldownMs: number;
  idempotencyTtlMs: number;
  maxCacheEntries: number;
  maxBodyBytes: number;
  alertColumns: string[];
  cardinalityColumns: string[];
  dailyRecapEnabled: boolean;
  /** Minutes past UTC midnight at which the daily recap is posted. */
  dailyRecapAtMinutes: number;
  recapSilent: boolean;
  escalationMultiplier: number;
  restartGraceMs: number;
  sweepIntervalMs: number;
  stateFile: string;
  stateDatabaseUrl: string;
  stateKey: string;
  stateLeaseSeconds: number;
  traceLogs: boolean;
}

export function loadConfig(
  env: Record<string, string | undefined>
): ServerConfig {
  const config: ServerConfig = {
    host: env.HOST?.trim() || "127.0.0.1",
    port: positiveInteger(env.PORT, 3000, "PORT"),
    clickStackWebhookSecret: required(env, "CLICKSTACK_WEBHOOK_SECRET"),
    telegramBotToken: required(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: required(env, "TELEGRAM_CHAT_ID"),
    cooldownMs:
      positiveInteger(env.COOLDOWN_SECONDS, 3600, "COOLDOWN_SECONDS") * 1000,
    idempotencyTtlMs:
      positiveInteger(
        env.IDEMPOTENCY_TTL_SECONDS,
        86400,
        "IDEMPOTENCY_TTL_SECONDS"
      ) * 1000,
    maxCacheEntries: positiveInteger(
      env.MAX_CACHE_ENTRIES,
      10000,
      "MAX_CACHE_ENTRIES"
    ),
    maxBodyBytes: positiveInteger(env.MAX_BODY_BYTES, 65536, "MAX_BODY_BYTES"),
    alertColumns: alertColumns(env.ALERT_COLUMNS),
    cardinalityColumns: columnList(env.CARDINALITY_COLUMNS),
    dailyRecapEnabled: booleanValue(
      env.DAILY_RECAP_ENABLED,
      true,
      "DAILY_RECAP_ENABLED"
    ),
    dailyRecapAtMinutes: clockMinutes(
      env.DAILY_RECAP_AT,
      6 * 60,
      "DAILY_RECAP_AT"
    ),
    recapSilent: booleanValue(env.RECAP_SILENT, true, "RECAP_SILENT"),
    escalationMultiplier: wholeNumber(
      env.ESCALATION_MULTIPLIER,
      10,
      "ESCALATION_MULTIPLIER"
    ),
    restartGraceMs:
      wholeNumber(env.RESTART_GRACE_SECONDS, 120, "RESTART_GRACE_SECONDS") *
      1000,
    sweepIntervalMs:
      positiveInteger(
        env.SWEEP_INTERVAL_SECONDS,
        60,
        "SWEEP_INTERVAL_SECONDS"
      ) * 1000,
    stateFile: env.STATE_FILE?.trim() ?? "",
    stateDatabaseUrl: env.STATE_DATABASE_URL?.trim() ?? "",
    stateKey: env.STATE_KEY?.trim() || "clickstack-telegram-relay",
    stateLeaseSeconds: positiveInteger(
      env.STATE_LEASE_SECONDS,
      300,
      "STATE_LEASE_SECONDS"
    ),
    traceLogs: booleanValue(env.TRACE_LOGS, false, "TRACE_LOGS"),
  };

  // The lease is renewed by the snapshot write, which only happens on a sweep.
  // A lease shorter than that interval expires between its own renewals, so
  // every instance would look abandoned and the guard would protect nothing.
  if (
    config.stateDatabaseUrl &&
    config.stateLeaseSeconds * 1000 <= config.sweepIntervalMs
  ) {
    throw new Error(
      "STATE_LEASE_SECONDS must exceed SWEEP_INTERVAL_SECONDS, or the write lease expires between snapshots"
    );
  }

  return config;
}

/**
 * Mirrors the saved search `select`, in the same order. ClickStack's alert body
 * is a headerless CSV block, so these names are what turns positional fields
 * into labelled ones.
 */
function alertColumns(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_ALERT_COLUMNS;
  }

  const columns = columnList(raw);
  if (columns.length === 0) {
    throw new Error("ALERT_COLUMNS must list at least one column name");
  }
  return columns;
}

function columnList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

/** Only the call signature, so tests can inject a plain function. */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createTelegramSender(
  config: Pick<
    ServerConfig,
    "telegramBotToken" | "telegramChatId" | "alertColumns"
  > &
    Partial<Pick<ServerConfig, "cardinalityColumns" | "recapSilent">>,
  fetchImpl: FetchLike = fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep
): TelegramSender {
  const post = (message: FormattedMessage, silent: boolean) =>
    fetchImpl(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text: message.text,
          ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
          disable_web_page_preview: true,
          ...(silent ? { disable_notification: true } : {}),
        }),
      }
    );

  return async (payload, context) => {
    // Recaps carry no new failure, so they land without a notification unless
    // an operator turns that off.
    const silent = context.silent && (config.recapSilent ?? true);
    const message = formatTelegramMessage(payload, {
      alertColumns: config.alertColumns,
      cardinalityColumns: config.cardinalityColumns,
      context,
    });
    let response = await post(message, silent);

    // All alerts land in one chat, so bursts across distinct eventIds hit
    // Telegram's per-chat rate limit. Absorb one short backoff here rather
    // than bouncing a 502 back and having ClickStack retry into the limit.
    if (response.status === 429) {
      const responseText = await response.text();
      const retryAfterMs = parseRetryAfterMs(responseText);
      if (
        retryAfterMs !== null &&
        retryAfterMs <= TELEGRAM_MAX_RETRY_AFTER_MS
      ) {
        await sleep(retryAfterMs);
        response = await post(message, silent);
      } else {
        throw new Error(
          `Telegram rate limited the relay (HTTP 429): ${responseText.slice(
            0,
            300
          )}`
        );
      }
    }

    // Telegram rejects the whole send when it dislikes an entity. Formatting is
    // cosmetic, so resend the raw ClickStack text rather than drop the alert.
    if (response.status === 400 && message.parseMode) {
      console.warn(
        JSON.stringify({
          event: "telegram_formatting_rejected",
          eventId: payload.eventId,
        })
      );
      response = await post(
        { text: formatPlainTelegramMessage(payload) },
        silent
      );
    }

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Telegram returned HTTP ${response.status}: ${responseText.slice(
          0,
          300
        )}`
      );
    }

    // The JSON `ok` field is the authoritative result, not the status code:
    // Telegram can answer HTTP 200 with {"ok":false,...}. Accepting that as
    // delivered would record a cooldown and acknowledge ClickStack, dropping
    // the alert silently for a full cooldown window.
    if (!isTelegramAcknowledgement(responseText)) {
      throw new Error(
        `Telegram did not acknowledge the message: ${responseText.slice(
          0,
          300
        )}`
      );
    }
  };
}

/**
 * Fails closed on unparseable bodies. A false negative costs a duplicate
 * message after ClickStack retries; a false positive loses the alert.
 */
function isTelegramAcknowledgement(responseText: string): boolean {
  try {
    const parsed: unknown = JSON.parse(responseText);
    return isRecord(parsed) && parsed.ok === true;
  } catch {
    return false;
  }
}

function parseRetryAfterMs(responseText: string): number | null {
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (!isRecord(parsed) || !isRecord(parsed.parameters)) {
      return null;
    }
    const retryAfter = parsed.parameters.retry_after;
    if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter)) {
      return null;
    }
    return Math.max(0, retryAfter) * 1000;
  } catch {
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads counts, row signatures and high-cardinality values out of a delivery.
 * The relay stays free of CSV knowledge; this is the only place that knows how
 * a ClickStack alert body is shaped.
 */
export function createAlertAnalyzer(
  config: Pick<ServerConfig, "alertColumns" | "cardinalityColumns">
): AlertAnalyzer {
  return (payload) =>
    analyzeAlert(payload, {
      alertColumns: config.alertColumns,
      cardinalityColumns: config.cardinalityColumns,
    });
}

export function createRequestHandler(
  relay: AlertRelay,
  config: Pick<ServerConfig, "clickStackWebhookSecret"> & {
    traceLogs?: boolean;
  }
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const trace = (event: string, details: Record<string, unknown> = {}) => {
      if (!config.traceLogs) {
        return;
      }
      console.info(
        JSON.stringify({
          event: "clickstack_webhook_trace",
          traceEvent: event,
          method: request.method,
          path: url.pathname,
          ...details,
        })
      );
    };

    trace("request_received", {
      contentType: request.headers.get("content-type"),
      hasAuthorization: request.headers.has("authorization"),
      hasIdempotencyKey: request.headers.has("idempotency-key"),
    });

    if (request.method === "GET" && url.pathname === "/healthz") {
      trace("health_check");
      return jsonResponse({ ok: true, cache: relay.stats() });
    }

    if (request.method !== "POST" || url.pathname !== "/webhooks/clickstack") {
      trace("request_rejected", { reason: "not_found" });
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    if (!hasValidBearerToken(request, config.clickStackWebhookSecret)) {
      trace("request_rejected", { reason: "unauthorized" });
      return jsonResponse({ ok: false, error: "unauthorized" }, 401, {
        "WWW-Authenticate": "Bearer",
      });
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 512) {
      trace("request_rejected", {
        reason: "invalid_idempotency_key",
        issue: !idempotencyKey ? "missing" : "too_long",
      });
      return jsonResponse({ ok: false, error: "invalid_idempotency_key" }, 400);
    }

    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      trace("request_rejected", { reason: "invalid_json" });
      return jsonResponse({ ok: false, error: "invalid_json" }, 400);
    }

    const validation = validatePayload(rawPayload);
    if (!validation.ok) {
      trace("request_rejected", {
        reason: "invalid_payload",
        issues: validation.issues,
      });
      return jsonResponse({ ok: false, error: "invalid_payload" }, 400);
    }
    const payload = validation.payload;
    trace("payload_accepted", {
      eventId: payload.eventId,
      state: payload.state,
      startTime: payload.startTime,
      endTime: payload.endTime,
    });

    try {
      const result = await relay.handle(payload, idempotencyKey);
      console.info(
        JSON.stringify({
          event: "clickstack_webhook",
          eventId: payload.eventId,
          state: payload.state,
          outcome: result.outcome,
        })
      );
      trace("request_completed", { outcome: result.outcome });
      return jsonResponse({ ok: true, outcome: result.outcome });
    } catch (error) {
      // These logs are the only record of a delivery failure: the relay does
      // not export to ClickStack. Without the message a timeout, a rate limit,
      // and an invalid chat ID are indistinguishable here.
      console.error(
        JSON.stringify({
          event: "telegram_delivery_failed",
          eventId: payload.eventId,
          state: payload.state,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: redactBotToken(
            error instanceof Error ? error.message : String(error)
          ).slice(0, 500),
          errorStack:
            error instanceof Error && error.stack
              ? redactBotToken(error.stack).slice(0, 1000)
              : undefined,
        })
      );
      trace("request_failed", {
        reason: "telegram_delivery_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return jsonResponse(
        { ok: false, error: "telegram_delivery_failed" },
        502
      );
    }
  };
}

type PayloadValidationResult =
  | { ok: true; payload: ClickStackWebhookPayload }
  | { ok: false; issues: string[] };

export function validatePayload(input: unknown): PayloadValidationResult {
  if (!isRecord(input)) {
    return { ok: false, issues: ["payload must be a JSON object"] };
  }

  const { eventId, state, title, body, link, startTime, endTime } = input;
  const issues: string[] = [];

  if (!isBoundedString(eventId, 1, 512)) {
    issues.push(stringIssue("eventId", eventId, 1, 512));
  }
  if (!isBoundedString(state, 0, 128)) {
    issues.push(stringIssue("state", state, 0, 128));
  }
  if (!isBoundedString(title, 1, 2048)) {
    issues.push(stringIssue("title", title, 1, 2048));
  } else if (title.trim().length === 0) {
    issues.push("title must contain non-whitespace text");
  }
  if (!isBoundedString(body, 0, MAX_BODY_FIELD_LENGTH)) {
    issues.push(stringIssue("body", body, 0, MAX_BODY_FIELD_LENGTH));
  }
  if (!isBoundedString(link, 0, 4096)) {
    issues.push(stringIssue("link", link, 0, 4096));
  }
  if (!Number.isFinite(startTime)) {
    issues.push(
      `startTime must be a finite number (received ${valueType(startTime)})`
    );
  }
  if (!Number.isFinite(endTime)) {
    issues.push(
      `endTime must be a finite number (received ${valueType(endTime)})`
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    payload: {
      eventId: eventId as string,
      state: state as string,
      title: title as string,
      body: body as string,
      link: link as string,
      startTime: startTime as number,
      endTime: endTime as number,
    },
  };
}

function hasValidBearerToken(request: Request, expected: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const actual = authorization.slice("Bearer ".length);
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function required(
  env: Record<string, string | undefined>,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  // Deliberately stricter than Number(): "0x10", "1e3" and " 12 " should be
  // reported as typos rather than silently parsed into a surprising value.
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/** Like `positiveInteger`, but `0` is meaningful: it disables the feature. */
function wholeNumber(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be zero or a positive integer`);
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be zero or a positive integer`);
  }
  return value;
}

/** "HH:MM" in UTC, as minutes past midnight. */
function clockMinutes(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) {
    throw new Error(`${name} must be a UTC time of day as HH:MM`);
  }
  return hours * 60 + minutes;
}

function booleanValue(
  raw: string | undefined,
  fallback: boolean,
  name: string
): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1, or 0`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(
  value: unknown,
  minLength: number,
  maxLength: number
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

function stringIssue(
  field: string,
  value: unknown,
  minLength: number,
  maxLength: number
): string {
  if (typeof value !== "string") {
    return `${field} must be a string (received ${valueType(value)})`;
  }
  return `${field} length must be between ${minLength} and ${maxLength} (received ${value.length})`;
}

function valueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
