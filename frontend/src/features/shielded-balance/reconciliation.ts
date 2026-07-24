export const WALLET_PORTFOLIO_FALLBACK_REFRESH_MS = 0;

const DEFAULT_RETRY_DELAYS_MS = [0, 250, 750, 1_500] as const;
const DEFAULT_READ_TIMEOUT_MS = 3_000;
const DEFAULT_POST_ACTION_REFRESH_TIMEOUT_MS = 5_000;
const DEFAULT_POST_ACTION_RECOVERY_DELAYS_MS = [1_000, 4_000] as const;

export type SecuredBalanceReconciliationResult =
  | {
      status: "reconciled";
      attempts: number;
      observedAmountRaw: bigint;
    }
  | {
      status: "pending";
      attempts: number;
      observedAmountRaw: bigint | null;
    };

export type LatestPortfolioRequestGuard = {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (requestId: number) => boolean;
};

export type PostActionRefreshResult =
  | { status: "completed" }
  | { status: "failed"; error: unknown }
  | { status: "timed_out" };

export function createLatestPortfolioRequestGuard(): LatestPortfolioRequestGuard {
  let latestRequestId = 0;

  return {
    begin: () => {
      latestRequestId += 1;
      return latestRequestId;
    },
    invalidate: () => {
      latestRequestId += 1;
    },
    isCurrent: (requestId) => requestId === latestRequestId,
  };
}

function readWithTimeout(
  readAmountRaw: () => Promise<bigint>,
  timeoutMs: number
): Promise<bigint> {
  if (timeoutMs <= 0) {
    return readAmountRaw();
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Secured balance read timed out.")),
      timeoutMs
    );
  });

  const readPromise = Promise.resolve().then(readAmountRaw);
  return Promise.race([readPromise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

/**
 * Reconcile a confirmed balance mutation with the authoritative ephemeral
 * account. This performs reads only; the transaction has already confirmed
 * before the caller enters this boundary.
 */
export async function reconcileSecuredBalance(args: {
  expectedAmountRaw: bigint;
  readAmountRaw: () => Promise<bigint>;
  retryDelaysMs?: readonly number[];
  readTimeoutMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<SecuredBalanceReconciliationResult> {
  const retryDelaysMs = args.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  if (retryDelaysMs.length === 0) {
    throw new Error("Secured balance reconciliation requires an attempt.");
  }

  const wait =
    args.wait ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  const readTimeoutMs = args.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  let observedAmountRaw: bigint | null = null;

  for (
    let attemptIndex = 0;
    attemptIndex < retryDelaysMs.length;
    attemptIndex++
  ) {
    const delayMs = retryDelaysMs[attemptIndex] ?? 0;
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      observedAmountRaw = await readWithTimeout(
        args.readAmountRaw,
        readTimeoutMs
      );
      if (observedAmountRaw === args.expectedAmountRaw) {
        return {
          status: "reconciled",
          attempts: attemptIndex + 1,
          observedAmountRaw,
        };
      }
    } catch {
      // A later bounded attempt may observe the confirmed state.
    }
  }

  return {
    status: "pending",
    attempts: retryDelaysMs.length,
    observedAmountRaw,
  };
}

export async function executeMaxUnshieldWithReconciliation<T>(args: {
  executeTransaction: () => Promise<T>;
  readAmountRaw: () => Promise<bigint>;
  retryDelaysMs?: readonly number[];
  readTimeoutMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<{
  confirmedAmountRaw: bigint;
  executionResult: T;
  reconciliation: SecuredBalanceReconciliationResult;
}> {
  const executionResult = await args.executeTransaction();
  const reconciliation = await reconcileSecuredBalance({
    expectedAmountRaw: BigInt(0),
    readAmountRaw: args.readAmountRaw,
    retryDelaysMs: args.retryDelaysMs,
    readTimeoutMs: args.readTimeoutMs,
    wait: args.wait,
  });

  return {
    confirmedAmountRaw: BigInt(0),
    executionResult,
    reconciliation,
  };
}

export async function settlePostActionRefresh(args: {
  refresh?: () => Promise<void> | void;
  timeoutMs?: number;
}): Promise<PostActionRefreshResult> {
  if (!args.refresh) {
    return { status: "completed" };
  }

  const timeoutMs = args.timeoutMs ?? DEFAULT_POST_ACTION_REFRESH_TIMEOUT_MS;
  if (timeoutMs <= 0) {
    throw new Error("Post-action refresh timeout must be positive.");
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const refreshResult: Promise<PostActionRefreshResult> = Promise.resolve()
    .then(args.refresh)
    .then((): PostActionRefreshResult => ({ status: "completed" }))
    .catch(
      (error: unknown): PostActionRefreshResult => ({ status: "failed", error })
    );
  const timeoutResult = new Promise<PostActionRefreshResult>((resolve) => {
    timeout = setTimeout(() => resolve({ status: "timed_out" }), timeoutMs);
  });

  return Promise.race([refreshResult, timeoutResult]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export async function recoverPostActionRefresh(args: {
  refresh?: () => Promise<void> | void;
  retryDelaysMs?: readonly number[];
  refreshTimeoutMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<PostActionRefreshResult[]> {
  if (!args.refresh) {
    return [];
  }

  const retryDelaysMs =
    args.retryDelaysMs ?? DEFAULT_POST_ACTION_RECOVERY_DELAYS_MS;
  const wait =
    args.wait ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  const results: PostActionRefreshResult[] = [];

  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await wait(delayMs);
    }
    results.push(
      await settlePostActionRefresh({
        refresh: args.refresh,
        timeoutMs: args.refreshTimeoutMs,
      })
    );
  }

  return results;
}
