export const MOBILE_LOADING_METRIC_NAME =
  "loyal.mobile.loading.duration" as const;

export const MOBILE_LOADING_OPERATIONS = [
  "app_load",
  "earn.deposit",
  "earn.withdrawal",
  "earn.refund",
  "earn.autodeposit.setup",
  "earn.autodeposit.floor_update",
  "earn.autodeposit.pause",
  "earn.autodeposit.resume",
  "earn.autodeposit.close",
  "earn.autodeposit.execute_now",
] as const;

export type MobileLoadingOperation = (typeof MOBILE_LOADING_OPERATIONS)[number];

export type MobileLoadingMetricEnvelope = {
  appSessionId: string;
  durationMs: number;
  environment: string;
  flowId?: string;
  metricName: typeof MOBILE_LOADING_METRIC_NAME;
  operation: MobileLoadingOperation;
  outcome: "completed" | "failed";
  pathname: string;
  phase: "app_ready" | "interaction_to_ui";
  platform: "android" | "ios";
  release: string;
  timestamp: string;
};

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_VALUE_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_EVENT_AGE_MS = 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export class InvalidMobileLoadingMetricError extends Error {
  constructor() {
    super("Invalid mobile loading metric envelope.");
    this.name = "InvalidMobileLoadingMetricError";
  }
}

function includes<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function parseMobileLoadingMetricEnvelope(
  value: unknown,
  now = Date.now(),
): MobileLoadingMetricEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMobileLoadingMetricError();
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "appSessionId",
    "durationMs",
    "environment",
    "flowId",
    "metricName",
    "operation",
    "outcome",
    "pathname",
    "phase",
    "platform",
    "release",
    "timestamp",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new InvalidMobileLoadingMetricError();
  }
  if (
    record.metricName !== MOBILE_LOADING_METRIC_NAME ||
    !includes(MOBILE_LOADING_OPERATIONS, record.operation) ||
    !includes(["completed", "failed"] as const, record.outcome) ||
    !includes(["app_ready", "interaction_to_ui"] as const, record.phase) ||
    !includes(["android", "ios"] as const, record.platform) ||
    typeof record.durationMs !== "number" ||
    !Number.isFinite(record.durationMs) ||
    record.durationMs < 0 ||
    record.durationMs > MAX_DURATION_MS ||
    typeof record.appSessionId !== "string" ||
    !UUID_V4_PATTERN.test(record.appSessionId)
  ) {
    throw new InvalidMobileLoadingMetricError();
  }
  const isAppLoad = record.operation === "app_load";
  if (
    (isAppLoad &&
      (record.phase !== "app_ready" || record.flowId !== undefined)) ||
    (!isAppLoad &&
      (record.phase !== "interaction_to_ui" ||
        typeof record.flowId !== "string" ||
        !UUID_V4_PATTERN.test(record.flowId)))
  ) {
    throw new InvalidMobileLoadingMetricError();
  }
  if (
    typeof record.pathname !== "string" ||
    !record.pathname.startsWith("/") ||
    record.pathname.length > 256 ||
    record.pathname.includes("?") ||
    record.pathname.includes("#") ||
    typeof record.environment !== "string" ||
    record.environment.length < 1 ||
    record.environment.length > 32 ||
    !RESOURCE_VALUE_PATTERN.test(record.environment) ||
    typeof record.release !== "string" ||
    record.release.length < 1 ||
    record.release.length > 80 ||
    !RESOURCE_VALUE_PATTERN.test(record.release)
  ) {
    throw new InvalidMobileLoadingMetricError();
  }
  const timestampMs =
    typeof record.timestamp === "string"
      ? Date.parse(record.timestamp)
      : Number.NaN;
  if (
    typeof record.timestamp !== "string" ||
    !Number.isFinite(timestampMs) ||
    new Date(timestampMs).toISOString() !== record.timestamp ||
    timestampMs < now - MAX_EVENT_AGE_MS ||
    timestampMs > now + MAX_CLOCK_SKEW_MS
  ) {
    throw new InvalidMobileLoadingMetricError();
  }

  return {
    ...(record as MobileLoadingMetricEnvelope),
    durationMs: Math.round(record.durationMs * 1000) / 1000,
  };
}
