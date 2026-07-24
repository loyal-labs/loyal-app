const MAX_CHUNK_URL_LENGTH = 1024;
const MAX_CONNECTION_RTT_MS = 10 * 60 * 1000;
const MAX_RESOURCE_DURATION_MS = 60 * 60 * 1000;
const MAX_RESOURCE_SIZE_BYTES = 2_147_483_647;
const CLIENT_BUILD_ID_PATTERN = /^[0-9a-f]{40}$/;
const PAGE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONNECTION_EFFECTIVE_TYPES = new Set(["slow-2g", "2g", "3g", "4g"]);
const DIAGNOSTIC_KEYS = new Set([
  "chunkUrl",
  "connectionEffectiveType",
  "connectionRttMs",
  "networkOnline",
  "resourceDurationMs",
  "resourceResponseStatus",
  "resourceTransferSize",
]);

export type BrowserChunkDiagnostics = {
  chunkUrl: string;
  connectionEffectiveType?: string;
  connectionRttMs?: number;
  networkOnline: boolean;
  resourceDurationMs?: number;
  resourceResponseStatus?: number;
  resourceTransferSize?: number;
};

export function isBrowserClientBuildId(value: string): boolean {
  return CLIENT_BUILD_ID_PATTERN.test(value);
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

export function isBrowserChunkUrlFromOrigin(
  value: string,
  expectedOrigin: string
): boolean {
  try {
    const origin = new URL(expectedOrigin).origin;
    return origin !== "null" && new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function readOptionalNumber(
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
    throw new Error("Invalid browser chunk diagnostic.");
  }
  return value;
}

export function normalizeBrowserChunkDiagnostics(
  value: unknown
): BrowserChunkDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !DIAGNOSTIC_KEYS.has(key))) {
      return null;
    }

    const chunkUrl =
      typeof record.chunkUrl === "string"
        ? normalizeBrowserChunkUrl(record.chunkUrl)
        : null;
    if (!chunkUrl || typeof record.networkOnline !== "boolean") {
      return null;
    }

    const connectionEffectiveType = record.connectionEffectiveType;
    if (
      connectionEffectiveType !== undefined &&
      (typeof connectionEffectiveType !== "string" ||
        !CONNECTION_EFFECTIVE_TYPES.has(connectionEffectiveType))
    ) {
      return null;
    }

    const connectionRttMs = readOptionalNumber(
      record,
      "connectionRttMs",
      MAX_CONNECTION_RTT_MS,
      true
    );
    const resourceDurationMs = readOptionalNumber(
      record,
      "resourceDurationMs",
      MAX_RESOURCE_DURATION_MS
    );
    const resourceResponseStatus = readOptionalNumber(
      record,
      "resourceResponseStatus",
      599,
      true
    );
    const resourceTransferSize = readOptionalNumber(
      record,
      "resourceTransferSize",
      MAX_RESOURCE_SIZE_BYTES,
      true
    );

    return {
      chunkUrl,
      ...(connectionEffectiveType ? { connectionEffectiveType } : {}),
      ...(connectionRttMs !== undefined ? { connectionRttMs } : {}),
      networkOnline: record.networkOnline,
      ...(resourceDurationMs !== undefined ? { resourceDurationMs } : {}),
      ...(resourceResponseStatus !== undefined
        ? { resourceResponseStatus }
        : {}),
      ...(resourceTransferSize !== undefined ? { resourceTransferSize } : {}),
    };
  } catch {
    return null;
  }
}
