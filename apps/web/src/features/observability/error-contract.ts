import {
  type BrowserChunkDiagnostics,
  isBrowserChunkUrlFromOrigin,
  isBrowserClientBuildId,
  isBrowserPageSessionId,
  normalizeBrowserChunkDiagnostics,
} from "./chunk-load-contract";

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
  "earn.deposit_batch.execute",
  "earn.deposit_policy_stage.execute",
  "earn.policy_setup.execute",
  "earn.withdrawal.execute",
  "earn.cleanup.execute",
  "earn.autodeposit_setup.execute",
  "earn.autodeposit_floor_update.execute",
  "earn.autodeposit_toggle.execute",
  "earn.autodeposit_close.execute",
  "earn.autoswap_setup.execute",
  "earn.autoswap_toggle.execute",
  "earn.autoswap_delete.execute",
  "vault.transfer.execute",
  "vault.swap.execute",
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

// Same vocabulary as the metrics contract's `platform`; a device identity is
// useless without knowing which OS fleet it belongs to (ASK-2097).
export const MOBILE_DEVICE_PLATFORMS = ["android", "ios"] as const;
export type MobileDevicePlatform = (typeof MOBILE_DEVICE_PLATFORMS)[number];

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ServerErrorOperation = "next.request.error";

export type ObservabilityRuntime = "browser" | "mobile" | "node";

export type BrowserErrorDiagnostics = BrowserChunkDiagnostics;

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

export type ParseBrowserErrorEnvelopeOptions = {
  expectedChunkOrigin: string;
  now?: number;
};

// Mobile envelopes carry their own release/environment: the app fleet mixes
// binary versions and OTA updates, so the server's Vercel release would be
// meaningless for them.
export type MobileErrorEnvelope = {
  /**
   * Stable per-install UUID, the join key for a device's whole telemetry
   * trail across sessions and wallets (ASK-2097). Optional: older clients
   * predate it.
   */
  deviceId?: string;
  devicePlatform?: MobileDevicePlatform;
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
  deviceId?: string;
  devicePlatform?: MobileDevicePlatform;
  exception: {
    message: string;
    name: string;
    stack?: string;
  };
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
  // Defaults to ERROR. WARN keeps a record out of the error alerts (e.g. CSP
  // report-only violations, which are informational until enforced).
  severity?: "ERROR" | "WARN";
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
  const clientBuildId =
    options.clientBuildId && isBrowserClientBuildId(options.clientBuildId)
      ? options.clientBuildId
      : null;
  const pageSessionId =
    options.pageSessionId && isBrowserPageSessionId(options.pageSessionId)
      ? options.pageSessionId
      : null;
  const diagnostics = options.diagnostics
    ? normalizeBrowserChunkDiagnostics(options.diagnostics) ?? undefined
    : undefined;
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

// The Cap captcha widget (@cap.js/widget) rejects with this internal error
// when it is torn down mid-solve: its worker pool is nulled while a solve
// promise is still in flight. Not a Loyal failure. `_ensureSize` is a Cap
// worker-pool method distinctive enough to match on message alone — the stack
// only shows a hash-named first-party chunk, so it cannot anchor the match.
const CAP_WIDGET_ERROR_PATTERN = /\b_ensureSize\b/;

export function isCapWidgetInternalError(
  operation: BrowserErrorOperation,
  message: string
): boolean {
  return (
    AMBIENT_BROWSER_ERROR_OPERATIONS.includes(operation) &&
    CAP_WIDGET_ERROR_PATTERN.test(message)
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
  options: ParseBrowserErrorEnvelopeOptions
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

  const clientContext = readBrowserClientContext(
    record,
    options.expectedChunkOrigin
  );

  return {
    ...parseCommonErrorEnvelopeFields(record, options.now ?? Date.now()),
    ...(clientContext.clientBuildId
      ? { clientBuildId: clientContext.clientBuildId }
      : {}),
    ...(clientContext.diagnostics
      ? { diagnostics: clientContext.diagnostics }
      : {}),
    operation: record.operation,
    ...(clientContext.pageSessionId
      ? { pageSessionId: clientContext.pageSessionId }
      : {}),
  };
}

/**
 * The chunk-load context is diagnostic enrichment, not the report itself.
 * Rejecting the whole envelope over it would drop the very ChunkLoadError we
 * need, so anything that fails validation is dropped and the error still
 * reaches ClickStack. Required envelope fields stay strictly validated.
 */
function readBrowserClientContext(
  record: Record<string, unknown>,
  expectedChunkOrigin: string
): {
  clientBuildId?: string;
  diagnostics?: BrowserErrorDiagnostics;
  pageSessionId?: string;
} {
  const { clientBuildId, diagnostics: rawDiagnostics, pageSessionId } = record;
  if (
    typeof clientBuildId !== "string" ||
    !isBrowserClientBuildId(clientBuildId) ||
    typeof pageSessionId !== "string" ||
    !isBrowserPageSessionId(pageSessionId)
  ) {
    return {};
  }

  const diagnostics =
    rawDiagnostics === undefined
      ? undefined
      : normalizeBrowserChunkDiagnostics(rawDiagnostics) ?? undefined;

  return {
    clientBuildId,
    ...(diagnostics &&
    isBrowserChunkUrlFromOrigin(diagnostics.chunkUrl, expectedChunkOrigin)
      ? { diagnostics }
      : {}),
    pageSessionId,
  };
}

export function createNormalizedBrowserErrorEvent(
  envelope: BrowserErrorEnvelope,
  context: {
    deploymentEnvironment: string;
    serverRelease: string;
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
    operation: envelope.operation,
    ...(envelope.pageSessionId
      ? { pageSessionId: envelope.pageSessionId }
      : {}),
    pathname: envelope.pathname,
    release: context.serverRelease,
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
    "deviceId",
    "devicePlatform",
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
  if (
    record.deviceId !== undefined &&
    (typeof record.deviceId !== "string" ||
      !DEVICE_ID_PATTERN.test(record.deviceId))
  ) {
    throw new InvalidObservabilityEnvelopeError();
  }
  if (
    record.devicePlatform !== undefined &&
    !MOBILE_DEVICE_PLATFORMS.includes(
      record.devicePlatform as MobileDevicePlatform
    )
  ) {
    throw new InvalidObservabilityEnvelopeError();
  }

  return {
    ...parseCommonErrorEnvelopeFields(record, now),
    ...(record.deviceId !== undefined
      ? { deviceId: record.deviceId as string }
      : {}),
    ...(record.devicePlatform !== undefined
      ? { devicePlatform: record.devicePlatform as MobileDevicePlatform }
      : {}),
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
