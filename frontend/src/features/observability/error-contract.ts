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
const MAX_CHUNK_URL_LENGTH = 1024;
const MAX_CONNECTION_DOWNLINK_MBPS = 100_000;
const MAX_CONNECTION_RTT_MS = 10 * 60 * 1000;
const MAX_RESOURCE_DURATION_MS = 60 * 60 * 1000;
const MAX_RESOURCE_SIZE_BYTES = 2_147_483_647;
const RESOURCE_VALUE_PATTERN = /[^A-Za-z0-9._-]/g;
const PAGE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONNECTION_EFFECTIVE_TYPES = new Set(["slow-2g", "2g", "3g", "4g"]);
const DOCUMENT_VISIBILITY_STATES = new Set(["hidden", "visible"]);

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

// The two ambient window listeners observe every script on the page, including
// wallet extensions injected into the document. Crashes those extensions cause
// among themselves are not Loyal failures and must not reach the error alert.
const AMBIENT_BROWSER_ERROR_OPERATIONS: readonly BrowserErrorOperation[] = [
  "browser.window.error",
  "browser.unhandled_rejection",
];

const EXTENSION_FRAME_PATTERN =
  /\b(?:chrome|moz|safari-web|safari|ms-browser)-extension:\/\//i;
const FIRST_PARTY_FRAME_PATTERN = /\bhttps?:\/\//i;

export const MOBILE_ERROR_OPERATIONS = [
  "mobile.global_error",
  "mobile.fatal_error",
  "mobile.unhandled_rejection",
] as const;

export type MobileErrorOperation = (typeof MOBILE_ERROR_OPERATIONS)[number];

export type ServerErrorOperation = "next.request.error";

export type ObservabilityRuntime = "browser" | "mobile" | "node";

export type BrowserErrorDiagnostics = {
  chunkUrl: string;
  connectionDownlinkMbps?: number;
  connectionEffectiveType?: string;
  connectionRttMs?: number;
  connectionSaveData?: boolean;
  documentVisibilityState?: string;
  networkOnline: boolean;
  resourceDecodedBodySize?: number;
  resourceDurationMs?: number;
  resourceEncodedBodySize?: number;
  resourceResponseStatus?: number;
  resourceTransferSize?: number;
};

export type BrowserErrorEnvelope = {
  clientBuildId?: string;
  diagnostics?: BrowserErrorDiagnostics;
  message: string;
  name: string;
  operation: BrowserErrorOperation;
  pageSessionId?: string;
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
  browserDiagnostics?: BrowserErrorDiagnostics;
  clientBuildId?: string;
  deploymentEnvironment: string;
  exception: {
    message: string;
    name: string;
    stack?: string;
  };
  ingestRelease?: string;
  method?: string;
  operation:
    | BrowserErrorOperation
    | MobileErrorOperation
    | ServerErrorOperation;
  pageSessionId?: string;
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
    clientBuildId?: string;
    diagnostics?: BrowserErrorDiagnostics;
    now?: Date;
    pageSessionId?: string;
    pathname?: string;
  } = {}
): BrowserErrorEnvelope {
  const normalizedError = normalizeUnknownError(error);
  const pathname = normalizeTelemetryPathname(
    options.pathname ??
      (typeof window === "undefined" ? "/" : window.location.pathname)
  );
  const clientBuildId = options.clientBuildId
    ? normalizeResourceValue(options.clientBuildId, MAX_RELEASE_LENGTH)
    : null;
  const pageSessionId =
    options.pageSessionId && isBrowserPageSessionId(options.pageSessionId)
      ? options.pageSessionId
      : null;
  let diagnostics: BrowserErrorDiagnostics | undefined;
  try {
    diagnostics = options.diagnostics
      ? parseBrowserErrorDiagnostics(options.diagnostics)
      : undefined;
  } catch {
    // Optional browser APIs may expose future values. Keep the core error
    // report and recovery path even when a diagnostic cannot be normalized.
  }
  const hasClientContext = Boolean(clientBuildId && pageSessionId);

  return {
    ...normalizedError,
    ...(hasClientContext && clientBuildId ? { clientBuildId } : {}),
    ...(hasClientContext && diagnostics ? { diagnostics } : {}),
    operation,
    ...(hasClientContext && pageSessionId ? { pageSessionId } : {}),
    pathname: pathname ?? "/",
    timestamp: (options.now ?? new Date()).toISOString(),
  };
}

// True when a stack is made up solely of browser-extension frames, meaning no
// Loyal code took part in the failure. Only ambient listeners are filtered:
// an explicit operation such as `earn.deposit.execute` reporting a wallet
// provider error is a real signal even though the stack points at the wallet.
export function isThirdPartyExtensionError(
  operation: BrowserErrorOperation,
  stack: string | undefined
): boolean {
  if (!stack || !AMBIENT_BROWSER_ERROR_OPERATIONS.includes(operation)) {
    return false;
  }

  return (
    EXTENSION_FRAME_PATTERN.test(stack) &&
    !FIRST_PARTY_FRAME_PATTERN.test(stack)
  );
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

export function isBrowserPageSessionId(value: string): boolean {
  return PAGE_SESSION_ID_PATTERN.test(value);
}

export function normalizeBrowserChunkUrl(value: string): string | null {
  if (value.length === 0 || value.length > MAX_CHUNK_URL_LENGTH) {
    return null;
  }

  try {
    const url = new URL(value);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (
      (url.protocol !== "https:" && !isLocalHttp) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith("/_next/static/chunks/") ||
      !url.pathname.endsWith(".js")
    ) {
      return null;
    }

    const normalized = url.toString();
    return normalized.length <= MAX_CHUNK_URL_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new InvalidObservabilityEnvelopeError();
  }
  return value;
}

function readOptionalBoundedNumber(
  record: Record<string, unknown>,
  key: string,
  max: number,
  integer = false
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new InvalidObservabilityEnvelopeError();
  }
  return value;
}

function readOptionalAllowedString(
  record: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new InvalidObservabilityEnvelopeError();
  }
  return value;
}

function parseBrowserErrorDiagnostics(value: unknown): BrowserErrorDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidObservabilityEnvelopeError();
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "chunkUrl",
    "connectionDownlinkMbps",
    "connectionEffectiveType",
    "connectionRttMs",
    "connectionSaveData",
    "documentVisibilityState",
    "networkOnline",
    "resourceDecodedBodySize",
    "resourceDurationMs",
    "resourceEncodedBodySize",
    "resourceResponseStatus",
    "resourceTransferSize",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new InvalidObservabilityEnvelopeError();
  }

  const chunkUrl = normalizeBrowserChunkUrl(
    readRequiredString(record, "chunkUrl")
  );
  if (!chunkUrl || typeof record.networkOnline !== "boolean") {
    throw new InvalidObservabilityEnvelopeError();
  }

  const connectionDownlinkMbps = readOptionalBoundedNumber(
    record,
    "connectionDownlinkMbps",
    MAX_CONNECTION_DOWNLINK_MBPS
  );
  const connectionEffectiveType = readOptionalAllowedString(
    record,
    "connectionEffectiveType",
    CONNECTION_EFFECTIVE_TYPES
  );
  const connectionRttMs = readOptionalBoundedNumber(
    record,
    "connectionRttMs",
    MAX_CONNECTION_RTT_MS,
    true
  );
  const connectionSaveData = readOptionalBoolean(record, "connectionSaveData");
  const documentVisibilityState = readOptionalAllowedString(
    record,
    "documentVisibilityState",
    DOCUMENT_VISIBILITY_STATES
  );
  const resourceDecodedBodySize = readOptionalBoundedNumber(
    record,
    "resourceDecodedBodySize",
    MAX_RESOURCE_SIZE_BYTES,
    true
  );
  const resourceDurationMs = readOptionalBoundedNumber(
    record,
    "resourceDurationMs",
    MAX_RESOURCE_DURATION_MS
  );
  const resourceEncodedBodySize = readOptionalBoundedNumber(
    record,
    "resourceEncodedBodySize",
    MAX_RESOURCE_SIZE_BYTES,
    true
  );
  const resourceResponseStatus = readOptionalBoundedNumber(
    record,
    "resourceResponseStatus",
    599,
    true
  );
  const resourceTransferSize = readOptionalBoundedNumber(
    record,
    "resourceTransferSize",
    MAX_RESOURCE_SIZE_BYTES,
    true
  );

  return {
    chunkUrl,
    ...(connectionDownlinkMbps !== undefined ? { connectionDownlinkMbps } : {}),
    ...(connectionEffectiveType ? { connectionEffectiveType } : {}),
    ...(connectionRttMs !== undefined ? { connectionRttMs } : {}),
    ...(connectionSaveData !== undefined ? { connectionSaveData } : {}),
    ...(documentVisibilityState ? { documentVisibilityState } : {}),
    networkOnline: record.networkOnline,
    ...(resourceDecodedBodySize !== undefined
      ? { resourceDecodedBodySize }
      : {}),
    ...(resourceDurationMs !== undefined ? { resourceDurationMs } : {}),
    ...(resourceEncodedBodySize !== undefined
      ? { resourceEncodedBodySize }
      : {}),
    ...(resourceResponseStatus !== undefined ? { resourceResponseStatus } : {}),
    ...(resourceTransferSize !== undefined ? { resourceTransferSize } : {}),
  };
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
    "clientBuildId",
    "diagnostics",
    "message",
    "name",
    "operation",
    "pageSessionId",
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

  const hasClientContext =
    record.clientBuildId !== undefined ||
    record.pageSessionId !== undefined ||
    record.diagnostics !== undefined;
  let clientBuildId: string | undefined;
  let pageSessionId: string | undefined;
  let diagnostics: BrowserErrorDiagnostics | undefined;
  if (hasClientContext) {
    clientBuildId = readResourceValue(
      record,
      "clientBuildId",
      MAX_RELEASE_LENGTH
    );
    pageSessionId = readRequiredString(record, "pageSessionId");
    if (!isBrowserPageSessionId(pageSessionId)) {
      throw new InvalidObservabilityEnvelopeError();
    }
    diagnostics =
      record.diagnostics === undefined
        ? undefined
        : parseBrowserErrorDiagnostics(record.diagnostics);
  }

  return {
    ...parseCommonErrorEnvelopeFields(record, now),
    ...(clientBuildId ? { clientBuildId } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    operation: record.operation,
    ...(pageSessionId ? { pageSessionId } : {}),
  };
}

export function createNormalizedBrowserErrorEvent(
  envelope: BrowserErrorEnvelope,
  context: {
    deploymentEnvironment: string;
    ingestRelease: string;
  }
): NormalizedErrorEvent {
  return {
    ...(envelope.diagnostics
      ? { browserDiagnostics: envelope.diagnostics }
      : {}),
    ...(envelope.clientBuildId
      ? { clientBuildId: envelope.clientBuildId }
      : {}),
    deploymentEnvironment: context.deploymentEnvironment,
    exception: {
      message: envelope.message,
      name: envelope.name,
      ...(envelope.stack ? { stack: envelope.stack } : {}),
    },
    ingestRelease: context.ingestRelease,
    operation: envelope.operation,
    ...(envelope.pageSessionId
      ? { pageSessionId: envelope.pageSessionId }
      : {}),
    pathname: envelope.pathname,
    release: envelope.clientBuildId ?? context.ingestRelease,
    runtime: "browser",
    serviceName: "loyal-frontend",
    timestamp: envelope.timestamp,
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
