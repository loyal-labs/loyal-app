import {
  isEarnRealtimeResyncRequired,
  parseEarnRealtimeMessage,
  type EarnRealtimeInvalidation,
} from "./types";

export type ParsedSseFrame = {
  data: string;
  event?: string;
  id?: string;
};

export type EarnRealtimeTokenResponse = {
  accessToken: string;
  eventsUrl: string;
  expiresAt: string;
  schemaVersion: 1;
};

export type EarnRealtimeStreamResult =
  | { reason: "closed" }
  | { reason: "resync_required"; detail: string };

export const EARN_REALTIME_SILENCE_TIMEOUT_MS = 45_000;

export class EarnRealtimeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly phase: "stream" | "token"
  ) {
    super(message);
    this.name = "EarnRealtimeHttpError";
  }
}

export class EarnRealtimeSilenceError extends Error {
  constructor() {
    super("Earn realtime stream heartbeat timed out.");
    this.name = "EarnRealtimeSilenceError";
  }
}

export function isEarnRealtimeAuthRejection(
  error: unknown
): error is EarnRealtimeHttpError {
  return (
    error instanceof EarnRealtimeHttpError &&
    error.phase === "stream" &&
    (error.status === 401 || error.status === 403)
  );
}

export class EarnRealtimeTokenCache {
  private current: EarnRealtimeTokenResponse | null = null;

  constructor(
    private readonly renewalLeadMs: number,
    private readonly now: () => number = Date.now
  ) {}

  async get(signal: AbortSignal): Promise<EarnRealtimeTokenResponse> {
    if (this.current && this.renewalDelayMs(this.current) > 0) {
      return this.current;
    }
    const token = await requestEarnRealtimeToken(signal);
    this.current = token;
    return token;
  }

  clear() {
    this.current = null;
  }

  renewalDelayMs(token: EarnRealtimeTokenResponse): number {
    const expiresAtMs = new Date(token.expiresAt).getTime();
    return Number.isFinite(expiresAtMs)
      ? expiresAtMs - this.now() - this.renewalLeadMs
      : 0;
  }
}

export class SseFrameParser {
  private buffer = "";

  push(chunk: string): ParsedSseFrame[] {
    this.buffer += chunk;
    const frames: ParsedSseFrame[] = [];

    while (true) {
      const boundary = this.buffer.match(/\r?\n\r?\n/);
      if (!boundary || boundary.index === undefined) {
        break;
      }
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const frame = parseSseFrame(block);
      if (frame) {
        frames.push(frame);
      }
    }

    return frames;
  }
}

function parseSseFrame(block: string): ParsedSseFrame | null {
  const frame: ParsedSseFrame = { data: "" };
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value =
      separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");

    if (field === "id") {
      frame.id = value;
    } else if (field === "event") {
      frame.event = value;
    } else if (field === "data") {
      frame.data = frame.data ? `${frame.data}\n${value}` : value;
    }
  }

  return frame.id || frame.event || frame.data ? frame : null;
}

function isTokenResponse(value: unknown): value is EarnRealtimeTokenResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (value as { accessToken?: unknown }).accessToken === "string" &&
    typeof (value as { eventsUrl?: unknown }).eventsUrl === "string" &&
    typeof (value as { expiresAt?: unknown }).expiresAt === "string"
  );
}

export async function requestEarnRealtimeToken(
  signal: AbortSignal
): Promise<EarnRealtimeTokenResponse> {
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/realtime/token",
    {
      credentials: "include",
      headers: { Accept: "application/json" },
      method: "POST",
      signal,
    }
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new EarnRealtimeHttpError(
      "Earn realtime is unavailable.",
      response.status,
      "token"
    );
  }
  if (!isTokenResponse(payload)) {
    throw new Error("Earn realtime is unavailable.");
  }
  return payload;
}

export function compareDecimalEventIds(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export async function consumeEarnRealtimeStream({
  cursor,
  onConnected,
  onInvalidation,
  response,
  scheduleSilenceTimeout = defaultScheduleSilenceTimeout,
  signal,
  silenceTimeoutMs = EARN_REALTIME_SILENCE_TIMEOUT_MS,
}: {
  cursor: string | null;
  onConnected: () => void;
  onInvalidation: (event: EarnRealtimeInvalidation) => void;
  response: EarnRealtimeTokenResponse;
  scheduleSilenceTimeout?: ScheduleSilenceTimeout;
  signal: AbortSignal;
  silenceTimeoutMs?: number;
}): Promise<EarnRealtimeStreamResult> {
  const streamResponse = await fetch(response.eventsUrl, {
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${response.accessToken}`,
      ...(cursor ? { "Last-Event-ID": cursor } : {}),
    },
    signal,
  });
  if (!streamResponse.ok) {
    throw new EarnRealtimeHttpError(
      "Earn realtime stream was rejected.",
      streamResponse.status,
      "stream"
    );
  }
  if (
    !streamResponse.body ||
    !streamResponse.headers.get("content-type")?.includes("text/event-stream")
  ) {
    throw new Error("Earn realtime stream was rejected.");
  }

  onConnected();
  const parser = new SseFrameParser();
  const decoder = new TextDecoder();
  const reader = streamResponse.body.getReader();
  let lastEventId = cursor;

  while (true) {
    const { done, value } = await readWithSilenceTimeout({
      reader,
      schedule: scheduleSilenceTimeout,
      silenceTimeoutMs,
    });
    if (done) {
      return { reason: "closed" };
    }
    const frames = parser.push(decoder.decode(value, { stream: true }));
    for (const frame of frames) {
      if (frame.event !== "loyal_yield" || !frame.data) {
        continue;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(frame.data);
      } catch {
        continue;
      }
      const message = parseEarnRealtimeMessage(decoded);
      if (!message) {
        continue;
      }
      if (isEarnRealtimeResyncRequired(message)) {
        return { detail: message.reason, reason: "resync_required" };
      }
      if (!frame.id || frame.id !== message.eventId) {
        continue;
      }
      if (
        lastEventId &&
        compareDecimalEventIds(message.eventId, lastEventId) <= 0
      ) {
        continue;
      }
      onInvalidation(message);
      lastEventId = message.eventId;
    }
  }
}

type ScheduleSilenceTimeout = (
  callback: () => void,
  delayMs: number
) => () => void;

const defaultScheduleSilenceTimeout: ScheduleSilenceTimeout = (
  callback,
  delayMs
) => {
  const timer = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timer);
};

async function readWithSilenceTimeout({
  reader,
  schedule,
  silenceTimeoutMs,
}: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  schedule: ScheduleSilenceTimeout;
  silenceTimeoutMs: number;
}): Promise<ReadableStreamReadResult<Uint8Array>> {
  const timeoutMarker = Symbol("earn-realtime-silence-timeout");
  let cancelTimeout: () => void = () => undefined;
  const timeout = new Promise<typeof timeoutMarker>((resolve) => {
    cancelTimeout = schedule(() => resolve(timeoutMarker), silenceTimeoutMs);
  });
  let result: ReadableStreamReadResult<Uint8Array> | typeof timeoutMarker;
  try {
    result = await Promise.race([reader.read(), timeout]);
  } finally {
    cancelTimeout();
  }
  if (result === timeoutMarker) {
    void reader
      .cancel("earn realtime heartbeat timed out")
      .catch(() => undefined);
    throw new EarnRealtimeSilenceError();
  }
  return result;
}

export function computeEarnRealtimeReconnectDelayMs(
  attempt: number,
  random = Math.random()
): number {
  const exponential = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
  return exponential + Math.floor(Math.max(0, Math.min(1, random)) * 250);
}
