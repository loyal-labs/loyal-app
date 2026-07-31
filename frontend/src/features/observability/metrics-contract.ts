import { isBrowserPageSessionId } from "./chunk-load-contract";
import { isCanonicalUuidV4 } from "./lifecycle-contract";
import { normalizeTelemetryPathname } from "./error-contract";

export const OBSERVABILITY_METRICS_ENDPOINT = "/api/observability/metrics";
export const MAX_METRICS_REQUEST_BYTES = 16 * 1024;

export const FRONTEND_LOADING_METRIC_NAME =
  "loyal.frontend.loading.duration" as const;

export const FRONTEND_LOADING_OPERATIONS = [
  "page_load",
  "earn.deposit",
  "earn.withdrawal",
  "earn.close",
  "earn.autodeposit.setup",
  "earn.autodeposit.close",
] as const;
export type FrontendLoadingOperation =
  (typeof FRONTEND_LOADING_OPERATIONS)[number];

export const FRONTEND_LOADING_PHASES = [
  "balances_ready",
  "interaction_to_preview",
  "wallet_confirmation_to_ui",
  "dependency",
] as const;
export type FrontendLoadingPhase = (typeof FRONTEND_LOADING_PHASES)[number];

export const FRONTEND_LOADING_DEPENDENCIES = [
  "loyal_api",
  "solana_rpc",
  "third_party_api",
] as const;
export type FrontendLoadingDependency =
  (typeof FRONTEND_LOADING_DEPENDENCIES)[number];

export const FRONTEND_LOADING_OUTCOMES = ["completed", "failed"] as const;
export type FrontendLoadingOutcome = (typeof FRONTEND_LOADING_OUTCOMES)[number];

export const FRONTEND_LOADING_PRESENTATIONS = ["in_app", "wallet"] as const;
export type FrontendLoadingPresentation =
  (typeof FRONTEND_LOADING_PRESENTATIONS)[number];

export type BrowserLoadingMetricEnvelope = {
  dependency?: FrontendLoadingDependency;
  durationMs: number;
  flowId?: string;
  metricName: typeof FRONTEND_LOADING_METRIC_NAME;
  operation: FrontendLoadingOperation;
  outcome: FrontendLoadingOutcome;
  pageSessionId?: string;
  pathname: string;
  phase: FrontendLoadingPhase;
  presentation?: FrontendLoadingPresentation;
  requestCount?: number;
  timestamp: string;
};

export type NormalizedLoadingMetric = BrowserLoadingMetricEnvelope & {
  deploymentEnvironment: string;
  release: string;
  serviceName: "loyal-frontend";
};

const MAX_METRIC_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_COUNT = 128;
const MAX_EVENT_AGE_MS = 60 * 60 * 1000;
const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export class InvalidMetricsEnvelopeError extends Error {
  constructor() {
    super("Invalid observability metrics envelope.");
    this.name = "InvalidMetricsEnvelopeError";
  }
}

export function classifyBrowserLoadingDependencyUrl(args: {
  pageOrigin: string;
  resourceUrl: string;
  rpcEndpoint?: string;
}): FrontendLoadingDependency | null {
  try {
    const pageOrigin = new URL(args.pageOrigin).origin;
    const resource = new URL(args.resourceUrl, pageOrigin);
    const rpc = args.rpcEndpoint ? new URL(args.rpcEndpoint, pageOrigin) : null;

    if (
      rpc &&
      resource.origin === rpc.origin &&
      resource.pathname === rpc.pathname
    ) {
      return "solana_rpc";
    }
    if (
      resource.origin === pageOrigin &&
      resource.pathname.startsWith("/api/")
    ) {
      return "loyal_api";
    }
    if (resource.origin === pageOrigin) {
      return null;
    }
    return resource.protocol === "http:" || resource.protocol === "https:"
      ? "third_party_api"
      : null;
  } catch {
    return null;
  }
}

function includes<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isFiniteNumberInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export function parseBrowserLoadingMetricEnvelope(
  value: unknown,
  now = Date.now()
): BrowserLoadingMetricEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMetricsEnvelopeError();
  }

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "dependency",
    "durationMs",
    "flowId",
    "metricName",
    "operation",
    "outcome",
    "pageSessionId",
    "pathname",
    "phase",
    "presentation",
    "requestCount",
    "timestamp",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new InvalidMetricsEnvelopeError();
  }

  if (
    record.metricName !== FRONTEND_LOADING_METRIC_NAME ||
    !includes(FRONTEND_LOADING_OPERATIONS, record.operation) ||
    !includes(FRONTEND_LOADING_PHASES, record.phase) ||
    !includes(FRONTEND_LOADING_OUTCOMES, record.outcome) ||
    !isFiniteNumberInRange(record.durationMs, 0, MAX_METRIC_DURATION_MS)
  ) {
    throw new InvalidMetricsEnvelopeError();
  }

  const pathname =
    typeof record.pathname === "string"
      ? normalizeTelemetryPathname(record.pathname)
      : null;
  if (!pathname) {
    throw new InvalidMetricsEnvelopeError();
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
    timestampMs > now + MAX_EVENT_CLOCK_SKEW_MS
  ) {
    throw new InvalidMetricsEnvelopeError();
  }

  if (
    record.pageSessionId !== undefined &&
    (typeof record.pageSessionId !== "string" ||
      !isBrowserPageSessionId(record.pageSessionId))
  ) {
    throw new InvalidMetricsEnvelopeError();
  }

  const isPageLoad = record.operation === "page_load";
  if (
    (isPageLoad && record.phase !== "balances_ready") ||
    (!isPageLoad && !isCanonicalUuidV4(record.flowId)) ||
    (isPageLoad && record.flowId !== undefined)
  ) {
    throw new InvalidMetricsEnvelopeError();
  }

  const isDependency = record.phase === "dependency";
  if (
    (isDependency &&
      (!includes(FRONTEND_LOADING_DEPENDENCIES, record.dependency) ||
        !Number.isInteger(record.requestCount) ||
        !isFiniteNumberInRange(record.requestCount, 0, MAX_REQUEST_COUNT))) ||
    (!isDependency &&
      (record.dependency !== undefined || record.requestCount !== undefined))
  ) {
    throw new InvalidMetricsEnvelopeError();
  }

  if (
    record.presentation !== undefined &&
    (!includes(FRONTEND_LOADING_PRESENTATIONS, record.presentation) ||
      record.phase !== "interaction_to_preview")
  ) {
    throw new InvalidMetricsEnvelopeError();
  }

  return {
    ...(record as BrowserLoadingMetricEnvelope),
    durationMs: Math.round(record.durationMs * 1000) / 1000,
    pathname,
  };
}

export function createBrowserLoadingMetricEnvelope(
  input: Omit<
    BrowserLoadingMetricEnvelope,
    "metricName" | "pathname" | "timestamp"
  > & {
    pathname?: string;
    timestamp?: string;
  }
): BrowserLoadingMetricEnvelope {
  const now = Date.now();
  return parseBrowserLoadingMetricEnvelope(
    {
      ...input,
      metricName: FRONTEND_LOADING_METRIC_NAME,
      pathname:
        input.pathname ??
        (typeof window === "undefined" ? "/" : window.location.pathname),
      timestamp: input.timestamp ?? new Date(now).toISOString(),
    },
    now
  );
}
