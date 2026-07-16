import "server-only";

import {
  type BrowserErrorEnvelope,
  type MobileErrorEnvelope,
  type NormalizedErrorEvent,
  normalizeTelemetryPathname,
  sanitizeTelemetryText,
  type ServerErrorOperation,
} from "./error-contract";
import type {
  BrowserLifecycleEnvelope,
  MobileLifecycleEnvelope,
  NormalizedLifecycleEvent,
} from "./lifecycle-contract";
import { buildOtlpErrorPayload, buildOtlpLifecyclePayload } from "./otlp";

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

function getTelemetryConfig(): TelemetryConfig | null {
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

    url.pathname = "/v1/logs";
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

async function exportOtlpPayload(payload: unknown): Promise<boolean> {
  const config = getTelemetryConfig();
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
  return exportOtlpPayload(buildOtlpErrorPayload(event));
}

async function exportLifecycleEvent(
  event: NormalizedLifecycleEvent
): Promise<boolean> {
  return exportOtlpPayload(buildOtlpLifecyclePayload(event));
}

export async function reportBrowserErrorEnvelope(
  envelope: BrowserErrorEnvelope
): Promise<boolean> {
  try {
    return await exportErrorEvent({
      deploymentEnvironment: getObservabilityDeploymentEnvironment(),
      exception: {
        message: envelope.message,
        name: envelope.name,
        ...(envelope.stack ? { stack: envelope.stack } : {}),
      },
      operation: envelope.operation,
      pathname: envelope.pathname,
      release: getObservabilityRelease(),
      runtime: "browser",
      serviceName: "loyal-frontend",
      timestamp: envelope.timestamp,
    });
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
      timestamp: new Date().toISOString(),
    });
  } catch {
    return false;
  }
}

export async function reportBrowserLifecycleEnvelope(
  envelope: BrowserLifecycleEnvelope,
  actorId?: string
): Promise<boolean> {
  try {
    return await exportLifecycleEvent({
      ...envelope,
      ...(actorId ? { actorId } : {}),
      deploymentEnvironment: getObservabilityDeploymentEnvironment(),
      release: getObservabilityRelease(),
      serviceName: "loyal-frontend",
    });
  } catch {
    return false;
  }
}

export async function reportMobileLifecycleEnvelope(
  envelope: MobileLifecycleEnvelope,
  actorId?: string
): Promise<boolean> {
  try {
    // The device reports its own release/environment; the wallet address only
    // feeds the actor-id derivation in the route and never reaches ClickStack.
    const { environment, release, ...event } = envelope;
    delete event.walletAddress;
    return await exportLifecycleEvent({
      ...event,
      ...(actorId ? { actorId } : {}),
      deploymentEnvironment: environment,
      release,
      serviceName: "loyal-mobile",
    });
  } catch {
    return false;
  }
}
