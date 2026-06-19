// Helius public frontend RPC hides the API key but is capped at 5 TPS per IP.
// Keep direct browser RPC below that ceiling; server routes may use private
// keyed RPC via rpc-endpoints.server.ts.
const DEFAULT_FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS = 250;
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

type RpcQueueState = {
  nextRunAt: number;
  tail: Promise<void>;
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
  var __loyalFrontendSolanaRpcQueue: RpcQueueState | undefined;
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcInflight:
    | Map<string, Promise<RpcResponseSnapshot>>
    | undefined;
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcRecent:
    | Map<string, RecentRpcResponseSnapshot>
    | undefined;
}

function getQueue() {
  globalThis.__loyalFrontendSolanaRpcQueue ??= {
    nextRunAt: 0,
    tail: Promise.resolve(),
  };

  return globalThis.__loyalFrontendSolanaRpcQueue;
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

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
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
  const queue = getQueue();
  const previous = queue.tail;
  let release!: () => void;
  queue.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);

  try {
    const delay = Math.max(0, queue.nextRunAt - Date.now());
    if (delay > 0) {
      await wait(delay);
    }

    queue.nextRunAt = Date.now() + getFrontendSolanaRpcMinIntervalMs();
    return await fetchImpl(input, init);
  } finally {
    release();
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

export function getFrontendSolanaRpcMinIntervalMs(): number {
  const rawValue =
    typeof process === "undefined"
      ? undefined
      : process.env[FRONTEND_SOLANA_RPC_MIN_INTERVAL_ENV_NAME];
  if (!rawValue) {
    return DEFAULT_FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS;
}

export function getFrontendSolanaRpcFetch(fetchImpl?: RpcFetch): RpcFetch {
  const runFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  return (async (input, init) => {
    const requestKey = parseRpcRequestKey(input, init);
    if (!requestKey) {
      return runQueuedFetch(runFetch, input, init);
    }

    const recentSnapshot = RECENTLY_CACHEABLE_RPC_METHODS.has(
      requestKey.method
    )
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
