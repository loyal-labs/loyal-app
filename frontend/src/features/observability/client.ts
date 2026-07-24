"use client";

import {
  type BrowserErrorDiagnostics,
  type BrowserErrorEnvelope,
  type BrowserErrorOperation,
  createBrowserErrorEnvelope,
  createErrorDeduplicator,
  type ErrorDeduplicator,
  isBrowserPageSessionId,
  isThirdPartyExtensionError,
  normalizeBrowserChunkUrl,
  OBSERVABILITY_ERROR_ENDPOINT,
} from "./error-contract";
import {
  type BrowserLifecycleEnvelope,
  createLifecycleTracker,
  type LifecycleFlowName,
  type LifecycleFlowVariant,
  type LifecycleTracker,
  OBSERVABILITY_LIFECYCLE_ENDPOINT,
} from "./lifecycle-contract";

const CLIENT_REPORT_TIMEOUT_MS = 1250;
const REPORT_BEFORE_RELOAD_GRACE_MS = 250;
const PAGE_SESSION_ID_STORAGE_KEY = "loyal.observability.page-session-id";
const CHUNK_RELOAD_GUARD_STORAGE_KEY =
  "loyal.observability.chunk-reload-attempted";
const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_GIT_COMMIT_HASH ?? "unknown";
const CHUNK_URL_CANDIDATE_PATTERN =
  /https?:\/\/[^\s)"']+|\/_next\/static\/chunks\/[^\s)"']+/g;

type BrowserNetworkInformation = {
  downlink?: number;
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
};

type BrowserResourceTiming = {
  decodedBodySize?: number;
  duration?: number;
  encodedBodySize?: number;
  responseStatus?: number;
  transferSize?: number;
};

export type BrowserErrorProcessor = {
  process: (error: unknown, operation: BrowserErrorOperation) => Promise<void>;
};

let cachedPageSessionId: string | undefined;

declare global {
  interface Window {
    __loyalObservabilityListenersInstalled__?: boolean;
  }
}

async function postBrowserError(envelope: BrowserErrorEnvelope): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    CLIENT_REPORT_TIMEOUT_MS
  );

  try {
    await fetch(OBSERVABILITY_ERROR_ENDPOINT, {
      body: JSON.stringify(envelope),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    // Telemetry is best-effort and must never affect the user flow.
  } finally {
    window.clearTimeout(timeout);
  }
}

function readErrorString(
  error: unknown,
  key: "message" | "name" | "request"
): string | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return undefined;
  }

  try {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function findFirstPartyChunkUrl(error: unknown): string | undefined {
  if (
    typeof window === "undefined" ||
    readErrorString(error, "name") !== "ChunkLoadError"
  ) {
    return undefined;
  }

  const candidates: string[] = [];
  const request = readErrorString(error, "request");
  if (request) {
    candidates.push(request);
  }
  const message = readErrorString(error, "message");
  if (message) {
    candidates.push(...(message.match(CHUNK_URL_CANDIDATE_PATTERN) ?? []));
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, window.location.origin);
      if (url.origin !== window.location.origin) {
        continue;
      }
      url.search = "";
      url.hash = "";
      const normalized = normalizeBrowserChunkUrl(url.toString());
      if (normalized) {
        return normalized;
      }
    } catch {
      // Ignore malformed resource hints and leave recovery disabled.
    }
  }

  return undefined;
}

function createRandomPageSessionId(): string | undefined {
  try {
    if (typeof window.crypto?.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  } catch {
    return undefined;
  }
}

function getPageSessionId(): string | undefined {
  if (cachedPageSessionId) {
    return cachedPageSessionId;
  }

  try {
    const stored = window.sessionStorage.getItem(PAGE_SESSION_ID_STORAGE_KEY);
    if (stored && isBrowserPageSessionId(stored)) {
      cachedPageSessionId = stored;
      return stored;
    }
  } catch {
    // A volatile random ID is still useful when storage is unavailable.
  }

  const generated = createRandomPageSessionId();
  if (!generated || !isBrowserPageSessionId(generated)) {
    return undefined;
  }

  cachedPageSessionId = generated;
  try {
    window.sessionStorage.setItem(PAGE_SESSION_ID_STORAGE_KEY, generated);
  } catch {
    // The reload guard below fails closed if session storage is unavailable.
  }
  return generated;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function collectChunkDiagnostics(chunkUrl: string): BrowserErrorDiagnostics {
  const connection = (
    window.navigator as Navigator & {
      connection?: BrowserNetworkInformation;
    }
  ).connection;
  const connectionDownlinkMbps = readNonNegativeNumber(connection?.downlink);
  const connectionRttMs = readNonNegativeNumber(connection?.rtt);
  const connectionEffectiveType =
    typeof connection?.effectiveType === "string"
      ? connection.effectiveType
      : undefined;
  const connectionSaveData =
    typeof connection?.saveData === "boolean" ? connection.saveData : undefined;
  const documentVisibilityState =
    window.document.visibilityState === "hidden" ||
    window.document.visibilityState === "visible"
      ? window.document.visibilityState
      : undefined;

  let resource: BrowserResourceTiming | undefined;
  try {
    const entries = window.performance.getEntriesByName(chunkUrl, "resource");
    resource = entries.at(-1) as BrowserResourceTiming | undefined;
  } catch {
    // Resource timing is optional and can be disabled by the browser.
  }

  const resourceDecodedBodySize = readNonNegativeNumber(
    resource?.decodedBodySize
  );
  const resourceDurationMs = readNonNegativeNumber(resource?.duration);
  const resourceEncodedBodySize = readNonNegativeNumber(
    resource?.encodedBodySize
  );
  const resourceResponseStatus = readNonNegativeNumber(
    resource?.responseStatus
  );
  const resourceTransferSize = readNonNegativeNumber(resource?.transferSize);

  return {
    chunkUrl,
    ...(connectionDownlinkMbps !== undefined ? { connectionDownlinkMbps } : {}),
    ...(connectionEffectiveType ? { connectionEffectiveType } : {}),
    ...(connectionRttMs !== undefined ? { connectionRttMs } : {}),
    ...(connectionSaveData !== undefined ? { connectionSaveData } : {}),
    ...(documentVisibilityState ? { documentVisibilityState } : {}),
    networkOnline: window.navigator.onLine,
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

function claimChunkReload(): boolean {
  try {
    if (window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_STORAGE_KEY) === "1") {
      return false;
    }

    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_STORAGE_KEY, "1");
    return (
      window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

async function waitForReportBeforeReload(
  reportPromise: Promise<void>
): Promise<void> {
  let timeout: number | undefined;
  const gracePeriod = new Promise<void>((resolve) => {
    timeout = window.setTimeout(resolve, REPORT_BEFORE_RELOAD_GRACE_MS);
  });

  try {
    await Promise.race([reportPromise, gracePeriod]);
  } finally {
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
  }
}

async function postBrowserLifecycle(
  envelope: BrowserLifecycleEnvelope
): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    CLIENT_REPORT_TIMEOUT_MS
  );

  try {
    await fetch(OBSERVABILITY_LIFECYCLE_ENDPOINT, {
      body: JSON.stringify(envelope),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
      signal: controller.signal,
    });
  } catch {
    // Lifecycle telemetry is best-effort and must never affect the user flow.
  } finally {
    window.clearTimeout(timeout);
  }
}

export function captureBrowserLifecycle(
  envelope: BrowserLifecycleEnvelope
): void {
  try {
    void postBrowserLifecycle(envelope).catch(() => undefined);
  } catch {
    // Lifecycle capture itself is never allowed to throw.
  }
}

export function createBrowserLifecycleTracker(args: {
  flowId?: string;
  flowName: LifecycleFlowName;
  flowVariant: LifecycleFlowVariant;
  pathname?: string;
}): LifecycleTracker {
  return createLifecycleTracker({
    emit: captureBrowserLifecycle,
    ...(args.flowId ? { flowId: args.flowId } : {}),
    flowName: args.flowName,
    flowVariant: args.flowVariant,
    pathname:
      args.pathname ??
      (typeof window === "undefined" ? "/" : window.location.pathname),
  });
}

export function lifecycleFlowHeaders(flowId: string): HeadersInit {
  return { "x-loyal-flow-id": flowId };
}

export function createBrowserErrorProcessor(
  options: {
    deduplicator?: ErrorDeduplicator;
  } = {}
): BrowserErrorProcessor {
  const deduplicator = options.deduplicator ?? createErrorDeduplicator();

  return {
    process: async (error, operation) => {
      try {
        const chunkUrl = findFirstPartyChunkUrl(error);
        const pageSessionId = getPageSessionId();
        const envelope = createBrowserErrorEnvelope(error, operation, {
          ...(pageSessionId
            ? {
                clientBuildId: CLIENT_BUILD_ID,
                pageSessionId,
              }
            : {}),
          ...(chunkUrl
            ? { diagnostics: collectChunkDiagnostics(chunkUrl) }
            : {}),
        });
        if (isThirdPartyExtensionError(envelope.operation, envelope.stack)) {
          return;
        }
        if (deduplicator.isDuplicate(envelope)) {
          return;
        }

        const reportPromise = postBrowserError(envelope);
        const shouldReload = Boolean(chunkUrl && claimChunkReload());
        if (!shouldReload) {
          await reportPromise;
          return;
        }

        await waitForReportBeforeReload(reportPromise);
        window.location.reload();
      } catch {
        // Error capture and recovery must never affect the user flow.
      }
    },
  };
}

const browserErrorProcessor = createBrowserErrorProcessor();

export function captureBrowserError(
  error: unknown,
  operation: BrowserErrorOperation
): void {
  try {
    void browserErrorProcessor.process(error, operation).catch(() => undefined);
  } catch {
    // Error capture itself is never allowed to throw.
  }
}

export function installBrowserErrorListeners(): void {
  if (
    typeof window === "undefined" ||
    window.__loyalObservabilityListenersInstalled__
  ) {
    return;
  }

  window.__loyalObservabilityListenersInstalled__ = true;
  window.addEventListener("error", (event) => {
    captureBrowserError(
      event.error ?? event.message ?? "Unknown browser error.",
      "browser.window.error"
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    captureBrowserError(event.reason, "browser.unhandled_rejection");
  });
}
