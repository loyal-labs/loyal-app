// Keep a small rolling window because a confirmation can release several
// independent refreshes at once. Helius may answer that browser burst with a
// 429 whose missing CORS headers surface only as `TypeError: Failed to fetch`.
const DEFAULT_FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_WINDOW = 5;
const FRONTEND_SOLANA_RPC_WINDOW_MS = 1000;
const FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS = 3;
const FRONTEND_SOLANA_RPC_RETRY_BASE_DELAY_MS = 250;
const FRONTEND_SOLANA_RPC_RETRY_MAX_DELAY_MS = 2000;
const FRONTEND_SOLANA_RPC_RETRY_JITTER_MS = 125;
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
const RETRYABLE_RPC_METHODS = RECENTLY_CACHEABLE_RPC_METHODS;
const TRANSACTION_CRITICAL_RPC_METHODS = new Set([
  "getBlockHeight",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "sendTransaction",
  "simulateTransaction",
]);
const BACKGROUND_RPC_METHODS = new Set(["getSignaturesForAddress"]);

type RpcFetch = typeof fetch;
type RpcPriority = 0 | 1 | 2;

type RpcQueueEntry = {
  dispatch: () => Promise<Response>;
  priority: RpcPriority;
  reject: (reason?: unknown) => void;
  resolve: (response: Response) => void;
  sequence: number;
};

interface RpcEndpointState {
  cooldownUntil: number;
  dispatchedAt: number[];
  nextSequence: number;
  queue: RpcQueueEntry[];
  rateLimitFailures: number;
  rateLimited: boolean;
  recoveryProbeInFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
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
  var __loyalFrontendSolanaRpcEndpoints:
    | Map<string, RpcEndpointState>
    | undefined;
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcInflight:
    | Map<string, Promise<RpcResponseSnapshot>>
    | undefined;
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcRecent:
    | Map<string, RecentRpcResponseSnapshot>
    | undefined;
}

function getEndpointState(endpoint: string): RpcEndpointState {
  globalThis.__loyalFrontendSolanaRpcEndpoints ??= new Map();
  const existing = globalThis.__loyalFrontendSolanaRpcEndpoints.get(endpoint);
  if (existing) {
    return existing;
  }

  const state: RpcEndpointState = {
    cooldownUntil: 0,
    dispatchedAt: [],
    nextSequence: 0,
    queue: [],
    rateLimitFailures: 0,
    rateLimited: false,
    recoveryProbeInFlight: false,
    timer: null,
  };
  globalThis.__loyalFrontendSolanaRpcEndpoints.set(endpoint, state);
  return state;
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

function getRpcPriority(requestKey: RpcRequestKey | null): RpcPriority {
  if (requestKey && TRANSACTION_CRITICAL_RPC_METHODS.has(requestKey.method)) {
    return 0;
  }
  if (requestKey && BACKGROUND_RPC_METHODS.has(requestKey.method)) {
    return 2;
  }
  return 1;
}

function getRetryAfterMs(response: Response | null): number | null {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) {
    return null;
  }

  const delayMs = retryAt - Date.now();
  return delayMs > 0 ? delayMs : null;
}

function getBackoffDelayMs(attempt: number): number {
  const exponentialDelay =
    FRONTEND_SOLANA_RPC_RETRY_BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.floor(
    Math.random() * FRONTEND_SOLANA_RPC_RETRY_JITTER_MS
  );
  return Math.min(
    FRONTEND_SOLANA_RPC_RETRY_MAX_DELAY_MS,
    exponentialDelay + jitter
  );
}

function scheduleEndpointPump(state: RpcEndpointState, delayMs: number): void {
  if (state.timer !== null) {
    return;
  }
  state.timer = setTimeout(() => {
    state.timer = null;
    pumpEndpointQueue(state);
  }, Math.max(0, delayMs));
}

function selectNextQueueEntry(state: RpcEndpointState): RpcQueueEntry | null {
  if (state.queue.length === 0) {
    return null;
  }

  let selectedIndex = 0;
  for (let index = 1; index < state.queue.length; index += 1) {
    const candidate = state.queue[index]!;
    const selected = state.queue[selectedIndex]!;
    if (
      candidate.priority < selected.priority ||
      (candidate.priority === selected.priority &&
        candidate.sequence < selected.sequence)
    ) {
      selectedIndex = index;
    }
  }

  return state.queue.splice(selectedIndex, 1)[0] ?? null;
}

function markEndpointRateLimited(
  state: RpcEndpointState,
  response: Response | null,
  isRecoveryProbe: boolean
): void {
  if (!state.rateLimited || isRecoveryProbe) {
    state.rateLimitFailures += 1;
  }
  state.rateLimited = true;
  if (isRecoveryProbe) {
    state.recoveryProbeInFlight = false;
  }
  const retryAfterMs = getRetryAfterMs(response);
  const cooldownMs =
    retryAfterMs ?? getBackoffDelayMs(Math.max(0, state.rateLimitFailures - 1));
  state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + cooldownMs);
}

function clearEndpointRateLimit(state: RpcEndpointState): void {
  state.cooldownUntil = 0;
  state.rateLimitFailures = 0;
  state.rateLimited = false;
  state.recoveryProbeInFlight = false;
}

function dispatchQueueEntry(
  state: RpcEndpointState,
  entry: RpcQueueEntry,
  isRecoveryProbe: boolean
): void {
  state.dispatchedAt.push(Date.now());
  if (isRecoveryProbe) {
    state.recoveryProbeInFlight = true;
  }

  entry
    .dispatch()
    .then((response) => {
      if (response.status === 429) {
        markEndpointRateLimited(state, response, isRecoveryProbe);
      } else if (isRecoveryProbe) {
        clearEndpointRateLimit(state);
      }
      entry.resolve(response);
    })
    .catch((error: unknown) => {
      if (error instanceof TypeError) {
        // Helius' CORS-less preflight 429 is exposed by browsers as TypeError.
        // Treat it as endpoint pressure so concurrent reads share one probe.
        markEndpointRateLimited(state, null, isRecoveryProbe);
      } else if (isRecoveryProbe) {
        clearEndpointRateLimit(state);
      }
      entry.reject(error);
    })
    .finally(() => pumpEndpointQueue(state));
}

function pruneDispatchWindow(state: RpcEndpointState, now: number): void {
  while (true) {
    const oldestDispatch = state.dispatchedAt[0];
    if (
      oldestDispatch === undefined ||
      oldestDispatch > now - FRONTEND_SOLANA_RPC_WINDOW_MS
    ) {
      return;
    }
    state.dispatchedAt.shift();
  }
}

function pumpEndpointQueue(state: RpcEndpointState): void {
  if (state.queue.length === 0) {
    return;
  }

  const now = Date.now();
  pruneDispatchWindow(state, now);
  const maxRequests = getFrontendSolanaRpcMaxRequestsPerWindow();

  if (state.rateLimited) {
    if (state.recoveryProbeInFlight) {
      return;
    }
    const oldestDispatch = state.dispatchedAt[0];
    const windowReadyAt =
      state.dispatchedAt.length >= maxRequests && oldestDispatch !== undefined
        ? oldestDispatch + FRONTEND_SOLANA_RPC_WINDOW_MS
        : now;
    const recoveryReadyAt = Math.max(state.cooldownUntil, windowReadyAt);
    if (recoveryReadyAt > now) {
      scheduleEndpointPump(state, recoveryReadyAt - now);
      return;
    }
    const recoveryProbe = selectNextQueueEntry(state);
    if (recoveryProbe) {
      dispatchQueueEntry(state, recoveryProbe, true);
    }
    return;
  }

  while (
    state.queue.length > 0 &&
    state.dispatchedAt.length < maxRequests &&
    !state.rateLimited
  ) {
    const entry = selectNextQueueEntry(state);
    if (!entry) {
      return;
    }
    dispatchQueueEntry(state, entry, false);
  }

  const oldestDispatch = state.dispatchedAt[0];
  if (state.queue.length > 0 && oldestDispatch !== undefined) {
    scheduleEndpointPump(
      state,
      oldestDispatch + FRONTEND_SOLANA_RPC_WINDOW_MS - Date.now()
    );
  }
}

function runQueuedFetch(
  fetchImpl: RpcFetch,
  input: Parameters<RpcFetch>[0],
  init: Parameters<RpcFetch>[1],
  requestKey: RpcRequestKey | null
): Promise<Response> {
  const endpoint = getInputUrl(input) ?? "unknown-solana-rpc-endpoint";
  const state = getEndpointState(endpoint);

  return new Promise<Response>((resolve, reject) => {
    state.queue.push({
      dispatch: async () => fetchImpl(input, init),
      priority: getRpcPriority(requestKey),
      reject,
      resolve,
      sequence: state.nextSequence,
    });
    state.nextSequence += 1;
    pumpEndpointQueue(state);
  });
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
  return getRetryAfterMs(response) ?? getBackoffDelayMs(attempt);
}

export class SolanaRpcRateLimitError extends Error {
  readonly code = "solana_rpc_rate_limited";
  readonly retryable = true;

  constructor(method: string) {
    super(`Solana RPC ${method} is rate limited. Please retry.`);
    this.name = "SolanaRpcRateLimitError";
  }
}

async function runRpcFetch(
  fetchImpl: RpcFetch,
  input: Parameters<RpcFetch>[0],
  init: Parameters<RpcFetch>[1],
  requestKey: RpcRequestKey | null
): Promise<Response> {
  const retryableMethod =
    requestKey && RETRYABLE_RPC_METHODS.has(requestKey.method)
      ? requestKey.method
      : null;
  const retryable = retryableMethod !== null;

  for (
    let attempt = 0;
    attempt < FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS;
    attempt += 1
  ) {
    let response: Response | null = null;
    try {
      response = await runQueuedFetch(fetchImpl, input, init, requestKey);
      if (!(retryable && isRetryableRpcResponse(response))) {
        return response;
      }
      if (attempt === FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS - 1) {
        if (response.status === 429) {
          throw new SolanaRpcRateLimitError(retryableMethod);
        }
        return response;
      }
    } catch (error) {
      if (!(retryable && error instanceof TypeError)) {
        throw error;
      }
      if (attempt === FRONTEND_SOLANA_RPC_MAX_READ_ATTEMPTS - 1) {
        throw new SolanaRpcRateLimitError(retryableMethod);
      }
    }

    // Endpoint-wide 429/TypeError cooldown is enforced by the queue. Keep a
    // local delay only for transient upstream 5xx responses.
    if (response?.status !== 429 && response !== null) {
      await wait(getRetryDelayMs(response, attempt));
    }
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
      return runQueuedFetch(runFetch, input, init, null);
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
