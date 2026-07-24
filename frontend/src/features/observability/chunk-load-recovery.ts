"use client";

import {
  type BrowserChunkDiagnostics,
  isBrowserClientBuildId,
  isBrowserPageSessionId,
  normalizeBrowserChunkUrl,
} from "./chunk-load-contract";

const CLIENT_REPORT_GRACE_MS = 250;
const PAGE_SESSION_ID_STORAGE_KEY = "loyal.observability.page-session-id";
const RELOAD_GUARD_STORAGE_KEY = "loyal.observability.chunk-reload-attempted";
const CHUNK_URL_CANDIDATE_PATTERN =
  /https?:\/\/[^\s)"']+|\/_next\/static\/chunks\/[^\s)"']+/g;

type BrowserNetworkInformation = {
  effectiveType?: string;
  rtt?: number;
};

type BrowserResourceTiming = {
  duration?: number;
  responseStatus?: number;
  transferSize?: number;
};

export type BrowserChunkLoadFailure = {
  chunkUrl: string;
  telemetry?: {
    clientBuildId: string;
    diagnostics: BrowserChunkDiagnostics;
    pageSessionId: string;
  };
};

let cachedPageSession:
  | {
      id: string;
      owner: Window;
    }
  | undefined;

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

  const request = readErrorString(error, "request");
  const message = readErrorString(error, "message");
  const candidates = [
    ...(request ? [request] : []),
    ...(message?.match(CHUNK_URL_CANDIDATE_PATTERN) ?? []),
  ];

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
      // Malformed resource hints cannot claim recovery.
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
  if (cachedPageSession?.owner === window) {
    return cachedPageSession.id;
  }

  try {
    const stored = window.sessionStorage.getItem(PAGE_SESSION_ID_STORAGE_KEY);
    if (stored && isBrowserPageSessionId(stored)) {
      cachedPageSession = { id: stored, owner: window };
      return stored;
    }
  } catch {
    // A volatile random ID still helps correlate the current error report.
  }

  const generated = createRandomPageSessionId();
  if (!generated || !isBrowserPageSessionId(generated)) {
    return undefined;
  }

  cachedPageSession = { id: generated, owner: window };
  try {
    window.sessionStorage.setItem(PAGE_SESSION_ID_STORAGE_KEY, generated);
  } catch {
    // The separate reload guard fails closed when storage is unavailable.
  }
  return generated;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function collectDiagnostics(chunkUrl: string): BrowserChunkDiagnostics {
  const connection = (
    window.navigator as Navigator & {
      connection?: BrowserNetworkInformation;
    }
  ).connection;
  const connectionEffectiveType =
    typeof connection?.effectiveType === "string"
      ? connection.effectiveType
      : undefined;
  const connectionRttMs = readNonNegativeNumber(connection?.rtt);

  let resource: BrowserResourceTiming | undefined;
  try {
    resource = window.performance
      .getEntriesByName(chunkUrl, "resource")
      .at(-1) as BrowserResourceTiming | undefined;
  } catch {
    // Resource timing is optional and can be unavailable.
  }

  const resourceDurationMs = readNonNegativeNumber(resource?.duration);
  const resourceResponseStatus = readNonNegativeNumber(
    resource?.responseStatus
  );
  const resourceTransferSize = readNonNegativeNumber(resource?.transferSize);

  return {
    chunkUrl,
    ...(connectionEffectiveType ? { connectionEffectiveType } : {}),
    ...(connectionRttMs !== undefined ? { connectionRttMs } : {}),
    networkOnline: window.navigator.onLine,
    ...(resourceDurationMs !== undefined ? { resourceDurationMs } : {}),
    ...(resourceResponseStatus !== undefined ? { resourceResponseStatus } : {}),
    ...(resourceTransferSize !== undefined ? { resourceTransferSize } : {}),
  };
}

export function inspectBrowserChunkLoadError(
  error: unknown,
  clientBuildId: string
): BrowserChunkLoadFailure | undefined {
  const chunkUrl = findFirstPartyChunkUrl(error);
  if (!chunkUrl) {
    return undefined;
  }

  const pageSessionId = getPageSessionId();
  return {
    chunkUrl,
    ...(isBrowserClientBuildId(clientBuildId) && pageSessionId
      ? {
          telemetry: {
            clientBuildId,
            diagnostics: collectDiagnostics(chunkUrl),
            pageSessionId,
          },
        }
      : {}),
  };
}

function claimReload(): boolean {
  try {
    if (window.sessionStorage.getItem(RELOAD_GUARD_STORAGE_KEY) === "1") {
      return false;
    }
    window.sessionStorage.setItem(RELOAD_GUARD_STORAGE_KEY, "1");
    return window.sessionStorage.getItem(RELOAD_GUARD_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export async function recoverBrowserChunkLoadErrorOnce(
  reportPromise: Promise<void>
): Promise<boolean> {
  if (!claimReload()) {
    return false;
  }

  let timeout: number | undefined;
  const gracePeriod = new Promise<void>((resolve) => {
    timeout = window.setTimeout(resolve, CLIENT_REPORT_GRACE_MS);
  });
  try {
    await Promise.race([reportPromise, gracePeriod]);
  } finally {
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
  }

  window.location.reload();
  return true;
}
