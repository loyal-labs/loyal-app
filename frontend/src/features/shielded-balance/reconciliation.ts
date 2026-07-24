export const WALLET_PORTFOLIO_FALLBACK_REFRESH_MS = 30_000;

const DEFAULT_RETRY_DELAYS_MS = [0, 250, 750, 1_500] as const;
const DEFAULT_READ_TIMEOUT_MS = 3_000;

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
