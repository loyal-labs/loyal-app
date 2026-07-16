export const OBSERVABILITY_ERROR_ENDPOINT = "/api/observability/errors";

export const MAX_OBSERVABILITY_REQUEST_BYTES = 16 * 1024;

const MAX_ERROR_NAME_LENGTH = 80;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const MAX_ERROR_STACK_LENGTH = 4096;
const MAX_PATHNAME_LENGTH = 256;
const MAX_RAW_FIELD_LENGTH = 12 * 1024;
const MAX_EVENT_AGE_MS = 60 * 60 * 1000;
const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_RELEASE_LENGTH = 80;
const MAX_ENVIRONMENT_LENGTH = 32;
const RESOURCE_VALUE_PATTERN = /[^A-Za-z0-9._-]/g;

const URL_QUERY_VALUE_PATTERN = /([?&][^=\s&#]{1,64}=)[^&#\s]*/g;
const BEARER_VALUE_PATTERN = /\bbearer\s+[^\s,;]+/gi;
const SENSITIVE_HEADER_PATTERN =
  /\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\n]*/gi;
const SECRET_VALUE_PATTERN =
  /\b(api[-_ ]?key|authorization|cookie|password|secret|session|token)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BODY_OR_HEADERS_PATTERN =
  /\b(request body|response body|request headers|response headers)\b\s*[:=]\s*[^\n]*/gi;
const LONG_BASE58_PATTERN =
  /(^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,})(?=$|[^1-9A-HJ-NP-Za-km-z])/g;
const LONG_HEX_PATTERN =
  /(^|[^A-Fa-f0-9])((?:0x)?[A-Fa-f0-9]{32,})(?=$|[^A-Fa-f0-9])/g;
const LONG_ENCODED_VALUE_PATTERN =
  /(^|[^A-Za-z0-9_+/=-])([A-Za-z0-9_+/=-]{64,})(?=$|[^A-Za-z0-9_+/=-])/g;

export const BROWSER_ERROR_OPERATIONS = [
  "browser.window.error",
  "browser.unhandled_rejection",
  "react.error_boundary",
  "react.global_error_boundary",
  "earn.deposit.confirmation",
  "earn.deposit.execute",
] as const;

export type BrowserErrorOperation = (typeof BROWSER_ERROR_OPERATIONS)[number];

export const MOBILE_ERROR_OPERATIONS = [
  "mobile.global_error",
  "mobile.fatal_error",
  "mobile.unhandled_rejection",
] as const;

export type MobileErrorOperation = (typeof MOBILE_ERROR_OPERATIONS)[number];

export type ServerErrorOperation = "next.request.error";

export type ObservabilityRuntime = "browser" | "mobile" | "node";

export type BrowserErrorEnvelope = {
  message: string;
  name: string;
  operation: BrowserErrorOperation;
  pathname: string;
  stack?: string;
  timestamp: string;
};

// Mobile envelopes carry their own release/environment: the app fleet mixes
// binary versions and OTA updates, so the server's Vercel release would be
// meaningless for them.
export type MobileErrorEnvelope = {
  environment: string;
  message: string;
  name: string;
  operation: MobileErrorOperation;
  pathname: string;
  release: string;
  stack?: string;
  timestamp: string;
};

export type NormalizedErrorEvent = {
  deploymentEnvironment: string;
  exception: {
    message: string;
    name: string;
    stack?: string;
  };
  method?: string;
  operation: BrowserErrorOperation | MobileErrorOperation | ServerErrorOperation;
  pathname: string;
  release: string;
  runtime: ObservabilityRuntime;
  serviceName: "loyal-frontend" | "loyal-mobile";
  timestamp: string;
};

export class InvalidObservabilityEnvelopeError extends Error {
  constructor() {
    super("Invalid observability error envelope.");
    this.name = "InvalidObservabilityEnvelopeError";
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

export function sanitizeTelemetryText(
  value: string,
  maxLength: number
): string {
  const redacted = value
    .replace(URL_QUERY_VALUE_PATTERN, "$1[REDACTED]")
    .replace(BEARER_VALUE_PATTERN, "Bearer [REDACTED]")
    .replace(SENSITIVE_HEADER_PATTERN, "$1=[REDACTED]")
    .replace(SECRET_VALUE_PATTERN, "$1$2[REDACTED]")
    .replace(BODY_OR_HEADERS_PATTERN, "$1=[REDACTED]")
    .replace(LONG_BASE58_PATTERN, "$1[REDACTED_IDENTIFIER]")
    .replace(LONG_HEX_PATTERN, "$1[REDACTED_IDENTIFIER]")
    .replace(LONG_ENCODED_VALUE_PATTERN, "$1[REDACTED_IDENTIFIER]");

  return truncate(redacted, maxLength);
}

export function normalizeTelemetryPathname(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > MAX_RAW_FIELD_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  try {
    const base = new URL("https://observability.invalid");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) {
      return null;
    }

    return sanitizeTelemetryText(parsed.pathname, MAX_PATHNAME_LENGTH);
  } catch {
    return null;
  }
}

function normalizeUnknownError(error: unknown): {
  message: string;
  name: string;
  stack?: string;
} {
  if (error instanceof Error) {
    const name = sanitizeTelemetryText(
      error.name || "Error",
      MAX_ERROR_NAME_LENGTH
    );
    const message = sanitizeTelemetryText(
      error.message || "Unknown error.",
      MAX_ERROR_MESSAGE_LENGTH
    );
    const stack = error.stack
      ? sanitizeTelemetryText(error.stack, MAX_ERROR_STACK_LENGTH)
      : undefined;

    return { message, name, ...(stack ? { stack } : {}) };
  }

  if (typeof error === "string") {
    return {
      message: sanitizeTelemetryText(error, MAX_ERROR_MESSAGE_LENGTH),
      name: "NonErrorException",
    };
  }

  return {
    message: "Unhandled non-Error exception.",
    name: "NonErrorException",
  };
}

export function createBrowserErrorEnvelope(
  error: unknown,
  operation: BrowserErrorOperation,
  options: {
    now?: Date;
    pathname?: string;
  } = {}
): BrowserErrorEnvelope {
  const normalizedError = normalizeUnknownError(error);
  const pathname = normalizeTelemetryPathname(
    options.pathname ??
      (typeof window === "undefined" ? "/" : window.location.pathname)
  );

  return {
    ...normalizedError,
    operation,
    pathname: pathname ?? "/",
    timestamp: (options.now ?? new Date()).toISOString(),
  };
}

function isAllowedBrowserOperation(
  value: unknown
): value is BrowserErrorOperation {
  return (
    typeof value === "string" &&
    BROWSER_ERROR_OPERATIONS.some((operation) => operation === value)
  );
}

function isAllowedMobileOperation(
  value: unknown
): value is MobileErrorOperation {
  return (
    typeof value === "string" &&
    MOBILE_ERROR_OPERATIONS.some((operation) => operation === value)
  );
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RAW_FIELD_LENGTH
  ) {
    throw new InvalidObservabilityEnvelopeError();
  }
  return value;
}

// Release/environment identify the reporting build in OTLP resource
// attributes; restrict them to a safe identifier alphabet.
export function normalizeResourceValue(
  value: string,
  maxLength: number
): string | null {
  const normalized = value
    .replace(RESOURCE_VALUE_PATTERN, "_")
    .slice(0, maxLength);
  return normalized.length > 0 ? normalized : null;
}

function readResourceValue(
  record: Record<string, unknown>,
  key: string,
  maxLength: number
): string {
  const normalized = normalizeResourceValue(
    readRequiredString(record, key),
    maxLength
  );
  if (!normalized) {
    throw new InvalidObservabilityEnvelopeError();
  }
  return normalized;
}

type CommonErrorEnvelopeFields = {
  message: string;
  name: string;
  pathname: string;
  stack?: string;
  timestamp: string;
};

function parseCommonErrorEnvelopeFields(
  record: Record<string, unknown>,
  now: number
): CommonErrorEnvelopeFields {
  const rawTimestamp = readRequiredString(record, "timestamp");
  const timestampMs = Date.parse(rawTimestamp);
  if (
    !Number.isFinite(timestampMs) ||
    new Date(timestampMs).toISOString() !== rawTimestamp ||
    timestampMs < now - MAX_EVENT_AGE_MS ||
    timestampMs > now + MAX_EVENT_CLOCK_SKEW_MS
  ) {
    throw new InvalidObservabilityEnvelopeError();
  }

  const pathname = normalizeTelemetryPathname(
    readRequiredString(record, "pathname")
  );
  if (!pathname) {
    throw new InvalidObservabilityEnvelopeError();
  }

  const rawStack = record.stack;
  if (
    rawStack !== undefined &&
    (typeof rawStack !== "string" || rawStack.length > MAX_RAW_FIELD_LENGTH)
  ) {
    throw new InvalidObservabilityEnvelopeError();
  }

  const name = sanitizeTelemetryText(
    readRequiredString(record, "name"),
    MAX_ERROR_NAME_LENGTH
  );
  const message = sanitizeTelemetryText(
    readRequiredString(record, "message"),
    MAX_ERROR_MESSAGE_LENGTH
  );
  const stack = rawStack
    ? sanitizeTelemetryText(rawStack, MAX_ERROR_STACK_LENGTH)
    : undefined;

  return {
    message,
    name,
    pathname,
    ...(stack ? { stack } : {}),
    timestamp: rawTimestamp,
  };
}

export function parseBrowserErrorEnvelope(
  value: unknown,
  now = Date.now()
): BrowserErrorEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidObservabilityEnvelopeError();
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "message",
    "name",
    "operation",
    "pathname",
    "stack",
    "timestamp",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new InvalidObservabilityEnvelopeError();
  }

  if (!isAllowedBrowserOperation(record.operation)) {
    throw new InvalidObservabilityEnvelopeError();
  }

  return {
    ...parseCommonErrorEnvelopeFields(record, now),
    operation: record.operation,
  };
}

export function parseMobileErrorEnvelope(
  value: unknown,
  now = Date.now()
): MobileErrorEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidObservabilityEnvelopeError();
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "environment",
    "message",
    "name",
    "operation",
    "pathname",
    "release",
    "stack",
    "timestamp",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new InvalidObservabilityEnvelopeError();
  }

  if (!isAllowedMobileOperation(record.operation)) {
    throw new InvalidObservabilityEnvelopeError();
  }

  return {
    ...parseCommonErrorEnvelopeFields(record, now),
    environment: readResourceValue(
      record,
      "environment",
      MAX_ENVIRONMENT_LENGTH
    ),
    operation: record.operation,
    release: readResourceValue(record, "release", MAX_RELEASE_LENGTH),
  };
}

export type ErrorDeduplicator = {
  isDuplicate: (envelope: BrowserErrorEnvelope) => boolean;
};

export function createErrorDeduplicator(
  options: {
    maxEntries?: number;
    now?: () => number;
    windowMs?: number;
  } = {}
): ErrorDeduplicator {
  const maxEntries = options.maxEntries ?? 128;
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 5000;
  const recent = new Map<string, number>();

  return {
    isDuplicate: (envelope) => {
      const currentTime = now();
      const fingerprint = [
        envelope.pathname,
        envelope.name,
        envelope.message,
        envelope.stack ?? "",
      ].join("\u0000");
      const previousTime = recent.get(fingerprint);

      for (const [key, reportedAt] of recent) {
        if (currentTime - reportedAt > windowMs) {
          recent.delete(key);
        }
      }

      if (
        previousTime !== undefined &&
        currentTime - previousTime <= windowMs
      ) {
        return true;
      }

      if (recent.size >= Math.max(1, maxEntries)) {
        const oldestKey = recent.keys().next().value;
        if (typeof oldestKey === "string") {
          recent.delete(oldestKey);
        }
      }
      recent.set(fingerprint, currentTime);
      return false;
    },
  };
}
