// Keep a small rolling window because a confirmation can release several
// independent refreshes at once. Helius may answer that browser burst with a
// 429 whose missing CORS headers surface only as `TypeError: Failed to fetch`.
const DEFAULT_FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_WINDOW = 5;
const FRONTEND_SOLANA_RPC_WINDOW_MS = 1000;
const FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS = 5;
const FRONTEND_SOLANA_RPC_RETRY_BASE_DELAY_MS = 250;
const FRONTEND_SOLANA_RPC_RETRY_MAX_DELAY_MS = 2000;
const FRONTEND_SOLANA_RPC_MAX_REQUESTS_ENV_NAME =
  "FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND";
const FRONTEND_SOLANA_RPC_MIN_INTERVAL_ENV_NAME =
  "FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS";
const FRONTEND_SOLANA_RPC_COMPLETED_RESULT_TTL_MS = 1000;
const FRONTEND_SOLANA_RPC_COMPLETED_RESULT_MAX_ENTRIES = 256;
const RECENTLY_CACHEABLE_RPC_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getLatestBlockhash",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getProgramAccountsV2",
  "getTokenAccountsByOwner",
]);
const RETRYABLE_RPC_METHODS = new Set([
  ...RECENTLY_CACHEABLE_RPC_METHODS,
  // Confirmation recovery must survive the same transient transport failures
  // as account reads. Never cache either changing response.
  "getSignatureStatuses",
  // Activity is loaded in the background when a wallet session appears.
  // Retry transport failures, but do not cache this changing history page.
  "getSignaturesForAddress",
]);

type RpcFetch = typeof fetch;

interface RpcWindowState {
  dispatchedAt: number[];
}

interface RpcRequestKey {
  cacheKey: string;
  hasRequestId: boolean;
  method: string;
  requestId: unknown;
}

interface RpcResponseSnapshot {
  bodyText: string;
  headers: [string, string][];
  ok: boolean;
  status: number;
  statusText: string;
}

interface RecentRpcResponseSnapshot {
  expiresAt: number;
  snapshot: RpcResponseSnapshot;
}

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
    while (true) {
      const oldestDispatch = window.dispatchedAt[0];
      if (
        oldestDispatch === undefined ||
        oldestDispatch > now - FRONTEND_SOLANA_RPC_WINDOW_MS
      ) {
        break;
      }
      window.dispatchedAt.shift();
    }

    // The check-and-record below runs synchronously within one event-loop
    // turn, so concurrent callers cannot both claim the window's last slot.
    if (window.dispatchedAt.length < maxRequests) {
      window.dispatchedAt.push(now);
      return fetchImpl(input, init);
    }

    const oldestDispatch = window.dispatchedAt[0];
    if (oldestDispatch !== undefined) {
      await wait(oldestDispatch + FRONTEND_SOLANA_RPC_WINDOW_MS - now);
    }
  }
}

function isRetryableRpcResponse(response: Response): boolean {
  return (
    response.status === 429 ||
    response.status === 500 ||
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504
  );
}

function getRetryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(
        FRONTEND_SOLANA_RPC_RETRY_MAX_DELAY_MS,
        Math.max(
          FRONTEND_SOLANA_RPC_RETRY_BASE_DELAY_MS,
          Math.ceil(seconds * 1000)
        )
      );
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(
        FRONTEND_SOLANA_RPC_RETRY_MAX_DELAY_MS,
        Math.max(FRONTEND_SOLANA_RPC_RETRY_BASE_DELAY_MS, retryAt - Date.now())
      );
    }
  }

  return Math.min(
    FRONTEND_SOLANA_RPC_RETRY_MAX_DELAY_MS,
    FRONTEND_SOLANA_RPC_RETRY_BASE_DELAY_MS * 2 ** attempt
  );
}

async function runRpcFetch(
  fetchImpl: RpcFetch,
  input: Parameters<RpcFetch>[0],
  init: Parameters<RpcFetch>[1],
  requestKey: RpcRequestKey | null
): Promise<Response> {
  const retryable = Boolean(
    requestKey && RETRYABLE_RPC_METHODS.has(requestKey.method)
  );

  for (
    let attempt = 0;
    attempt < FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS;
    attempt += 1
  ) {
    let response: Response | null = null;
    try {
      response = await runQueuedFetch(fetchImpl, input, init);
      if (
        !(retryable && isRetryableRpcResponse(response)) ||
        attempt === FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS - 1
      ) {
        return response;
      }
    } catch (error) {
      if (
        !(retryable && error instanceof TypeError) ||
        attempt === FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS - 1
      ) {
        throw error;
      }
    }

    await wait(getRetryDelayMs(response, attempt));
  }

  throw new Error("Frontend Solana RPC retry loop exhausted unexpectedly.");
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

    const request = runRpcFetch(runFetch, input, init, requestKey)
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
