import "server-only";

import {
  type BrowserErrorEnvelope,
  type NormalizedErrorEvent,
  normalizeTelemetryPathname,
  sanitizeTelemetryText,
  type ServerErrorOperation,
} from "./error-contract";
import { buildOtlpErrorPayload } from "./otlp";

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

function getRelease(): string {
  const release =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_GIT_COMMIT_HASH ??
    "unknown";
  return (
    release.replace(RESOURCE_VALUE_PATTERN, "_").slice(0, MAX_RELEASE_LENGTH) ||
    "unknown"
  );
}

function getDeploymentEnvironment(): string {
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

async function exportErrorEvent(event: NormalizedErrorEvent): Promise<boolean> {
  const config = getTelemetryConfig();
  if (!config) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

  try {
    const response = await fetch(config.endpoint, {
      body: JSON.stringify(buildOtlpErrorPayload(event)),
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

export async function reportBrowserErrorEnvelope(
  envelope: BrowserErrorEnvelope
): Promise<boolean> {
  try {
    return await exportErrorEvent({
      deploymentEnvironment: getDeploymentEnvironment(),
      exception: {
        message: envelope.message,
        name: envelope.name,
        ...(envelope.stack ? { stack: envelope.stack } : {}),
      },
      operation: envelope.operation,
      pathname: envelope.pathname,
      release: getRelease(),
      runtime: "browser",
      serviceName: "loyal-frontend",
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
      deploymentEnvironment: getDeploymentEnvironment(),
      exception: normalizedError,
      ...(method ? { method } : {}),
      operation: options.operation,
      pathname,
      release: getRelease(),
      runtime: "node",
      serviceName: "loyal-frontend",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return false;
  }
}
