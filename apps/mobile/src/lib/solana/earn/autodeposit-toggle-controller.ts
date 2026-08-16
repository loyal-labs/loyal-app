export type AutodepositToggleController = {
  request(active: boolean): Promise<void>;
};

export type AutodepositToggleControllerOptions = {
  debounceMs?: number;
  // `flowId` comes from the submission handle below, so the loading metric for
  // this press and the lifecycle flow the submit starts share one id.
  submit(active: boolean, flowId?: string): Promise<void>;
  refresh(): Promise<boolean | null>;
  onSubmissionStart?(active: boolean): {
    complete(): void;
    fail(): void;
    flowId?: string;
  };
  onOptimisticActive(active: boolean): void;
  onReconciledActive(active: boolean): void;
};

type PendingCycle = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

function createPendingCycle(): PendingCycle {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Coalesces an interactive switch into a serialized latest-value queue.
// Before the first request starts, debounce replaces the pending value. Once a
// request is in flight, presses replace one follow-up slot; the loop submits
// only the final value seen after the active request settles.
export function createAutodepositToggleController(
  options: AutodepositToggleControllerOptions
): AutodepositToggleController {
  const debounceMs = options.debounceMs ?? 250;
  let latestRequested: boolean | null = null;
  let pendingCycle: PendingCycle | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isDraining = false;

  const drain = async (): Promise<void> => {
    if (isDraining || !pendingCycle || latestRequested === null) {
      return;
    }
    isDraining = true;

    let hasTerminalError = false;
    let terminalError: unknown;

    while (latestRequested !== null) {
      const submittedActive: boolean = latestRequested;
      const submission = options.onSubmissionStart?.(submittedActive);
      let submitSucceeded = false;
      try {
        await options.submit(submittedActive, submission?.flowId);
        submitSucceeded = true;
        hasTerminalError = false;
        terminalError = undefined;
      } catch (error) {
        hasTerminalError = true;
        terminalError = error;
      }

      // A press arrived while the request was active. Skip every intermediate
      // value and immediately submit the latest one.
      if (latestRequested !== submittedActive) {
        if (submitSucceeded) {
          submission?.complete();
        } else {
          submission?.fail();
        }
        continue;
      }

      let authoritativeActive: boolean | null = null;
      let refreshError: unknown;
      try {
        authoritativeActive = await options.refresh();
      } catch (error) {
        refreshError = error;
      }

      // A press can also arrive while the final refresh is in flight. The
      // refreshed value is already stale in that case, so continue the same
      // serialized cycle and refresh again only after its true final request.
      if (latestRequested !== submittedActive) {
        continue;
      }

      if (authoritativeActive !== null) {
        options.onReconciledActive(authoritativeActive);
      }
      if (!hasTerminalError && refreshError !== undefined) {
        hasTerminalError = true;
        terminalError = refreshError;
      }
      if (submitSucceeded && refreshError === undefined) {
        submission?.complete();
      } else {
        submission?.fail();
      }
      break;
    }

    const completedCycle = pendingCycle;
    pendingCycle = null;
    latestRequested = null;
    isDraining = false;

    if (hasTerminalError) {
      completedCycle.reject(terminalError);
    } else {
      completedCycle.resolve();
    }
  };

  return {
    request(active: boolean): Promise<void> {
      options.onOptimisticActive(active);
      latestRequested = active;
      pendingCycle ??= createPendingCycle();

      if (!isDraining) {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void drain();
        }, debounceMs);
      }

      return pendingCycle.promise;
    },
  };
}
