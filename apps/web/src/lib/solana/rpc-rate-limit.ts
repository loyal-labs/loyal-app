// The dedicated frontend Helius endpoints tolerate concurrent bursts (a
// 12-request burst returns all-200 in ~100ms — verified while debugging
// ASK-2043), so the limiter is a rolling one-second window rather than the
// old strict 250ms serial spacing. Serial spacing taxed every multi-read
// flow with 250ms per request — a deposit prepare's ~12 reads took ~3s in
// the browser no matter how parallel the calling code was.
const DEFAULT_FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_WINDOW = 15;
const FRONTEND_SOLANA_RPC_WINDOW_MS = 1_000;
const FRONTEND_SOLANA_RPC_MAX_REQUESTS_ENV_NAME =
  "FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND";
const FRONTEND_SOLANA_RPC_MIN_INTERVAL_ENV_NAME =
  "FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS";
const FRONTEND_SOLANA_RPC_COMPLETED_RESULT_TTL_MS = 1_000;
const FRONTEND_SOLANA_RPC_COMPLETED_RESULT_MAX_ENTRIES = 256;
const RECENTLY_CACHEABLE_RPC_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getLatestBlockhash",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getTokenAccountsByOwner",
]);

type RpcFetch = typeof fetch;

type RpcWindowState = {
  dispatchedAt: number[];
};

type RpcRequestKey = {
  cacheKey: string;
  method: string;
  requestId: unknown;
  hasRequestId: boolean;
};

type RpcResponseSnapshot = {
  bodyText: string;
  headers: [string, string][];
  ok: boolean;
  status: number;
  statusText: string;
};

type RecentRpcResponseSnapshot = {
  expiresAt: number;
  snapshot: RpcResponseSnapshot;
};

declare global {
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcWindow: RpcWindowState | undefined;
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcInflight:
    | Map<string, Promise<RpcResponseSnapshot>>
    | undefined;
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcRecent:
    | Map<string, RecentRpcResponseSnapshot>
    | undefined;
}

function getWindow() {
  globalThis.__loyalFrontendSolanaRpcWindow ??= {
    dispatchedAt: [],
  };

  return globalThis.__loyalFrontendSolanaRpcWindow;
}

function getInflightRequests() {
  globalThis.__loyalFrontendSolanaRpcInflight ??= new Map<
    string,
    Promise<RpcResponseSnapshot>
  >();

  return globalThis.__loyalFrontendSolanaRpcInflight;
}

function getRecentResponses() {
  globalThis.__loyalFrontendSolanaRpcRecent ??= new Map<
    string,
    RecentRpcResponseSnapshot
  >();

  return globalThis.__loyalFrontendSolanaRpcRecent;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInputUrl(input: Parameters<RpcFetch>[0]): string | null {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }

  return null;
}

function getInputMethod(
  input: Parameters<RpcFetch>[0],
  init: Parameters<RpcFetch>[1]
): string {
  if (init?.method) {
    return init.method;
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method;
  }

  return "GET";
}

function parseRpcRequestKey(
  input: Parameters<RpcFetch>[0],
  init: Parameters<RpcFetch>[1]
): RpcRequestKey | null {
  if (getInputMethod(input, init).toUpperCase() !== "POST") {
    return null;
  }

  const url = getInputUrl(input);
  if (!url || typeof init?.body !== "string") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const request = parsed as {
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  if (typeof request.method !== "string") {
    return null;
  }

  return {
    cacheKey: `${url}\n${request.method}\n${JSON.stringify(
      request.params ?? null
    )}`,
    hasRequestId: Object.hasOwn(request, "id"),
    method: request.method,
    requestId: request.id,
  };
}

async function runQueuedFetch(
  fetchImpl: RpcFetch,
  input: Parameters<RpcFetch>[0],
  init: Parameters<RpcFetch>[1]
): Promise<Response> {
  const window = getWindow();
  const maxRequests = getFrontendSolanaRpcMaxRequestsPerWindow();

  for (;;) {
    const now = Date.now();
    while (
      window.dispatchedAt.length > 0 &&
      window.dispatchedAt[0]! <= now - FRONTEND_SOLANA_RPC_WINDOW_MS
    ) {
      window.dispatchedAt.shift();
    }

    // The check-and-record below runs synchronously within one event-loop
    // turn, so concurrent callers cannot both claim the window's last slot.
    if (window.dispatchedAt.length < maxRequests) {
      window.dispatchedAt.push(now);
      return fetchImpl(input, init);
    }

    await wait(window.dispatchedAt[0]! + FRONTEND_SOLANA_RPC_WINDOW_MS - now);
  }
}

async function snapshotResponse(
  response: Response
): Promise<RpcResponseSnapshot> {
  return {
    bodyText: await response.text(),
    headers: Array.from(response.headers.entries()).filter(([name]) => {
      const normalizedName = name.toLowerCase();
      return (
        normalizedName !== "content-encoding" &&
        normalizedName !== "content-length" &&
        normalizedName !== "transfer-encoding"
      );
    }),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

function rewriteRpcResponseId(
  bodyText: string,
  requestKey: RpcRequestKey
): string {
  if (!requestKey.hasRequestId) {
    return bodyText;
  }

  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Object.hasOwn(parsed, "id")
    ) {
      return bodyText;
    }

    return JSON.stringify({
      ...parsed,
      id: requestKey.requestId,
    });
  } catch {
    return bodyText;
  }
}

function createResponseFromSnapshot(
  snapshot: RpcResponseSnapshot,
  requestKey: RpcRequestKey
): Response {
  return new Response(rewriteRpcResponseId(snapshot.bodyText, requestKey), {
    headers: snapshot.headers,
    status: snapshot.status,
    statusText: snapshot.statusText,
  });
}

function isJsonRpcSuccess(snapshot: RpcResponseSnapshot): boolean {
  if (!snapshot.ok) {
    return false;
  }

  try {
    const parsed = JSON.parse(snapshot.bodyText) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      !Object.hasOwn(parsed, "error")
    );
  } catch {
    return false;
  }
}

function getRecentSnapshot(cacheKey: string): RpcResponseSnapshot | null {
  const recentResponses = getRecentResponses();
  const recent = recentResponses.get(cacheKey);
  if (!recent) {
    return null;
  }

  if (recent.expiresAt <= Date.now()) {
    recentResponses.delete(cacheKey);
    return null;
  }

  return recent.snapshot;
}

function setRecentSnapshot(cacheKey: string, snapshot: RpcResponseSnapshot) {
  const recentResponses = getRecentResponses();
  const now = Date.now();

  for (const [entryKey, entry] of recentResponses) {
    if (entry.expiresAt <= now) {
      recentResponses.delete(entryKey);
    }
  }

  while (
    recentResponses.size >= FRONTEND_SOLANA_RPC_COMPLETED_RESULT_MAX_ENTRIES
  ) {
    const oldestKey = recentResponses.keys().next().value;
    if (!oldestKey) {
      break;
    }
    recentResponses.delete(oldestKey);
  }

  recentResponses.set(cacheKey, {
    expiresAt: now + FRONTEND_SOLANA_RPC_COMPLETED_RESULT_TTL_MS,
    snapshot,
  });
}

export function getFrontendSolanaRpcMaxRequestsPerWindow(): number {
  const env = typeof process === "undefined" ? undefined : process.env;
  const rawMaxRequests = env?.[FRONTEND_SOLANA_RPC_MAX_REQUESTS_ENV_NAME];
  if (rawMaxRequests) {
    const parsed = Number.parseInt(rawMaxRequests, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Honor a legacy min-interval override as an equivalent per-second ceiling.
  const rawInterval = env?.[FRONTEND_SOLANA_RPC_MIN_INTERVAL_ENV_NAME];
  if (rawInterval) {
    const parsed = Number.parseInt(rawInterval, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.floor(FRONTEND_SOLANA_RPC_WINDOW_MS / parsed));
    }
  }

  return DEFAULT_FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_WINDOW;
}

export function getFrontendSolanaRpcFetch(fetchImpl?: RpcFetch): RpcFetch {
  const runFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  return (async (input, init) => {
    const requestKey = parseRpcRequestKey(input, init);
    if (!requestKey) {
      return runQueuedFetch(runFetch, input, init);
    }

    const recentSnapshot = RECENTLY_CACHEABLE_RPC_METHODS.has(requestKey.method)
      ? getRecentSnapshot(requestKey.cacheKey)
      : null;
    if (recentSnapshot) {
      return createResponseFromSnapshot(recentSnapshot, requestKey);
    }

    const inflightRequests = getInflightRequests();
    const existingRequest = inflightRequests.get(requestKey.cacheKey);
    if (existingRequest) {
      const snapshot = await existingRequest;
      return createResponseFromSnapshot(snapshot, requestKey);
    }

    const request = runQueuedFetch(runFetch, input, init)
      .then(snapshotResponse)
      .then((snapshot) => {
        if (
          RECENTLY_CACHEABLE_RPC_METHODS.has(requestKey.method) &&
          isJsonRpcSuccess(snapshot)
        ) {
          setRecentSnapshot(requestKey.cacheKey, snapshot);
        }

        return snapshot;
      })
      .finally(() => {
        inflightRequests.delete(requestKey.cacheKey);
      });
    inflightRequests.set(requestKey.cacheKey, request);

    const snapshot = await request;
    return createResponseFromSnapshot(snapshot, requestKey);
  }) as RpcFetch;
}
