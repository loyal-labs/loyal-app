import "server-only";

import {
  type BrowserErrorEnvelope,
  createNormalizedBrowserErrorEvent,
  type MobileErrorEnvelope,
  type NormalizedErrorEvent,
  normalizeTelemetryPathname,
  type ServerErrorOperation,
  sanitizeTelemetryText,
} from "./error-contract";
import type {
  BrowserLifecycleEnvelope,
  MobileLifecycleEnvelope,
  NormalizedLifecycleEvent,
} from "./lifecycle-contract";
import type {
  BrowserLoadingMetricEnvelope,
  MobileLoadingMetricEnvelope,
  NormalizedLoadingMetric,
} from "./metrics-contract";
import {
  buildOtlpErrorPayload,
  buildOtlpLifecyclePayload,
  buildOtlpJourneyTracePayload,
  buildOtlpLoadingMetricPayload,
} from "./otlp";

const EXPORT_TIMEOUT_MS = 1250;
const MAX_METHOD_LENGTH = 16;
const MAX_RELEASE_LENGTH = 80;
const MAX_ENVIRONMENT_LENGTH = 32;
const RESOURCE_VALUE_PATTERN = /[^A-Za-z0-9._-]/g;
const ALLOWED_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

type TelemetryConfig = {
  endpoint: string;
  ingestionKey: string;
};

type OtlpSignal = "logs" | "metrics" | "traces";

function getTelemetryConfig(signal: OtlpSignal): TelemetryConfig | null {
  const rawEndpoint = process.env.OBSERVABILITY_OTLP_ENDPOINT?.trim();
  const ingestionKey = process.env.OBSERVABILITY_INGESTION_API_KEY?.trim();
  if (!rawEndpoint || !ingestionKey) {
    return null;
  }

  try {
    const url = new URL(rawEndpoint);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (url.protocol !== "https:" && !isLocalHttp) {
      return null;
    }

    url.pathname = `/v1/${signal}`;
    url.search = "";
    url.hash = "";
    return { endpoint: url.toString(), ingestionKey };
  } catch {
    return null;
  }
}

export function getObservabilityRelease(): string {
  const release =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_GIT_COMMIT_HASH ??
    "unknown";
  return (
    release.replace(RESOURCE_VALUE_PATTERN, "_").slice(0, MAX_RELEASE_LENGTH) ||
    "unknown"
  );
}

export function getObservabilityDeploymentEnvironment(): string {
  const environment =
    process.env.VERCEL_ENV ??
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT ??
    "unknown";
  return (
    environment
      .replace(RESOURCE_VALUE_PATTERN, "_")
      .slice(0, MAX_ENVIRONMENT_LENGTH) || "unknown"
  );
}

function normalizeMethod(method: string | undefined): string | undefined {
  const normalized = method?.trim().toUpperCase();
  return normalized &&
    normalized.length <= MAX_METHOD_LENGTH &&
    ALLOWED_METHODS.has(normalized)
    ? normalized
    : undefined;
}

async function exportOtlpPayload(
  payload: unknown,
  signal: OtlpSignal = "logs"
): Promise<boolean> {
  const config = getTelemetryConfig(signal);
  if (!config) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

  try {
    const response = await fetch(config.endpoint, {
      body: JSON.stringify(payload),
      cache: "no-store",
      headers: {
        authorization: config.ingestionKey,
        "content-type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function exportErrorEvent(event: NormalizedErrorEvent): Promise<boolean> {
  return exportOtlpPayload(buildOtlpErrorPayload(event), "logs");
}

async function exportLifecycleEvent(
  event: NormalizedLifecycleEvent
): Promise<boolean> {
  const traces = buildOtlpJourneyTracePayload(event);
  const results = await Promise.all([
    exportOtlpPayload(buildOtlpLifecyclePayload(event), "logs"),
    ...(traces ? [exportOtlpPayload(traces, "traces")] : []),
  ]);
  return results.every(Boolean);
}

async function exportLoadingMetric(
  event: NormalizedLoadingMetric
): Promise<boolean> {
  return exportOtlpPayload(buildOtlpLoadingMetricPayload(event), "metrics");
}

export async function reportBrowserErrorEnvelope(
  envelope: BrowserErrorEnvelope
): Promise<boolean> {
  try {
    return await exportErrorEvent(
      createNormalizedBrowserErrorEvent(envelope, {
        deploymentEnvironment: getObservabilityDeploymentEnvironment(),
        serverRelease: getObservabilityRelease(),
      })
    );
  } catch {
    return false;
  }
}

export async function reportMobileErrorEnvelope(
  envelope: MobileErrorEnvelope
): Promise<boolean> {
  try {
    return await exportErrorEvent({
      // The device reports its own release/environment — the app fleet mixes
      // binary versions and OTA updates that Vercel's release can't describe.
      deploymentEnvironment: envelope.environment,
      ...(envelope.deviceId ? { deviceId: envelope.deviceId } : {}),
      ...(envelope.devicePlatform
        ? { devicePlatform: envelope.devicePlatform }
        : {}),
      exception: {
        message: envelope.message,
        name: envelope.name,
        ...(envelope.stack ? { stack: envelope.stack } : {}),
      },
      operation: envelope.operation,
      pathname: envelope.pathname,
      release: envelope.release,
      runtime: "mobile",
      serviceName: "loyal-mobile",
      timestamp: envelope.timestamp,
    });
  } catch {
    return false;
  }
}

export async function reportServerError(
  error: unknown,
  options: {
    method?: string;
    operation: ServerErrorOperation;
    pathname: string;
    severity?: NormalizedErrorEvent["severity"];
  }
): Promise<boolean> {
  try {
    const pathname = normalizeTelemetryPathname(options.pathname) ?? "/";
    const method = normalizeMethod(options.method);
    const normalizedError =
      error instanceof Error
        ? {
            message: sanitizeTelemetryText(error.message, 512),
            name: sanitizeTelemetryText(error.name || "Error", 80),
            ...(error.stack
              ? { stack: sanitizeTelemetryText(error.stack, 4096) }
              : {}),
          }
        : {
            message: "Unhandled non-Error exception.",
            name: "NonErrorException",
          };

    return await exportErrorEvent({
      deploymentEnvironment: getObservabilityDeploymentEnvironment(),
      exception: normalizedError,
      ...(method ? { method } : {}),
      operation: options.operation,
      pathname,
      release: getObservabilityRelease(),
      runtime: "node",
      serviceName: "loyal-frontend",
      ...(options.severity ? { severity: options.severity } : {}),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return false;
  }
}

export function getJourneyTrafficKind(
  walletAddress?: string
): "external" | "internal" | "synthetic" {
  return process.env.OBSERVABILITY_TRAFFIC_KIND === "synthetic" &&
    !["production", "prod"].includes(getObservabilityDeploymentEnvironment())
    ? "synthetic"
    : walletAddress &&
      (
        process.env.OBSERVABILITY_INTERNAL_WALLETS ??
        "BmzZz5VTNU57EHaGwyDcP1vXz9a8RwEDYAcPCdW4nPg1"
      )
        .split(",")
        .map((value) => value.trim())
        .includes(walletAddress)
    ? "internal"
    : "external";
}

export async function reportBrowserLifecycleEnvelope(
  envelope: BrowserLifecycleEnvelope,
  walletAddress?: string
): Promise<boolean> {
  try {
    return await exportLifecycleEvent({
      ...envelope,
      ...(walletAddress ? { walletAddress } : {}),
      ...(walletAddress
        ? {
            userId: Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new Uint8Array(new TextEncoder().encode(walletAddress)).buffer
                )
              ),
              (byte) => byte.toString(16).padStart(2, "0")
            ).join(""),
          }
        : {}),
      trafficKind: getJourneyTrafficKind(walletAddress),
      deploymentEnvironment: getObservabilityDeploymentEnvironment(),
      release: getObservabilityRelease(),
      serviceName: "loyal-frontend",
    });
  } catch {
    return false;
  }
}

export async function reportBrowserLoadingMetricEnvelope(
  envelope: BrowserLoadingMetricEnvelope
): Promise<boolean> {
  try {
    return await exportLoadingMetric({
      ...envelope,
      deploymentEnvironment: getObservabilityDeploymentEnvironment(),
      release: getObservabilityRelease(),
      serviceName: "loyal-frontend",
    });
  } catch {
    return false;
  }
}

export async function reportMobileLoadingMetricEnvelope(
  envelope: MobileLoadingMetricEnvelope
): Promise<boolean> {
  try {
    const { environment, release, ...event } = envelope;
    return await exportLoadingMetric({
      ...event,
      deploymentEnvironment: environment,
      release,
      serviceName: "loyal-mobile",
    });
  } catch {
    return false;
  }
}

export async function reportMobileLifecycleEnvelope(
  envelope: MobileLifecycleEnvelope,
  walletAddress?: string
): Promise<boolean> {
  try {
    // The device reports its own release/environment. An explicit wallet
    // argument wins over the envelope's so the route stays the single place
    // that decides which address is trusted.
    const { environment, release, ...event } = envelope;
    const resolvedWallet = walletAddress ?? event.walletAddress;
    return await exportLifecycleEvent({
      ...event,
      ...(resolvedWallet ? { walletAddress: resolvedWallet } : {}),
      deploymentEnvironment: environment,
      release,
      serviceName: "loyal-mobile",
    });
  } catch {
    return false;
  }
}

/** Independent of user traffic; the cron response also exposes exporter failure. */
export async function reportTelemetryHeartbeat(): Promise<boolean> {
  const timeUnixNano = String(BigInt(Date.now()) * BigInt(1_000_000));
  return exportOtlpPayload(
    {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "loyal-frontend" } },
              {
                key: "service.version",
                value: { stringValue: getObservabilityRelease() },
              },
              {
                key: "deployment.environment.name",
                value: { stringValue: getObservabilityDeploymentEnvironment() },
              },
            ],
          },
          scopeLogs: [
            {
              scope: { name: "loyal.frontend.telemetry-health", version: "1" },
              logRecords: [
                {
                  timeUnixNano,
                  observedTimeUnixNano: timeUnixNano,
                  severityNumber: 9,
                  severityText: "INFO",
                  body: { stringValue: "telemetry.heartbeat" },
                  attributes: [
                    {
                      key: "loyal.event.kind",
                      value: { stringValue: "telemetry_heartbeat" },
                    },
                    {
                      key: "loyal.traffic.kind",
                      value: { stringValue: "synthetic" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    "logs"
  );
}
