import {
  computeEarnRealtimeReconnectDelayMs,
  consumeEarnRealtimeStream,
  type EarnRealtimeStreamResult,
  type EarnRealtimeTokenResponse,
} from "./stream";
import type { EarnRealtimeInvalidation } from "./types";

type EarnRealtimeTokenCacheContract = {
  clear: () => void;
  get: (signal: AbortSignal) => Promise<EarnRealtimeTokenResponse>;
  renewalDelayMs: (token: EarnRealtimeTokenResponse) => number;
};

type ConsumeEarnRealtimeStream = (args: {
  cursor: string | null;
  onConnected: () => void;
  onInvalidation: (event: EarnRealtimeInvalidation) => void;
  response: EarnRealtimeTokenResponse;
  signal: AbortSignal;
}) => Promise<EarnRealtimeStreamResult>;

type ScheduleRenewal = (callback: () => void, delayMs: number) => () => void;
type WaitForReconnect = (attempt: number, signal: AbortSignal) => Promise<void>;

export type EarnRealtimeLifecycleOptions = {
  clearCursor: () => void;
  consumeStream?: ConsumeEarnRealtimeStream;
  getCursor: () => string | null;
  onConnected: () => void;
  onConnecting: (isReconnect: boolean) => void;
  onError?: (error: unknown) => void;
  onInvalidation: (event: EarnRealtimeInvalidation) => void;
  onResyncRequired: () => Promise<void> | void;
  scheduleRenewal?: ScheduleRenewal;
  signal: AbortSignal;
  tokenCache: EarnRealtimeTokenCacheContract;
  waitForReconnect?: WaitForReconnect;
};

function linkAbortSignal(parent: AbortSignal, child: AbortController) {
  if (parent.aborted) {
    child.abort();
    return () => undefined;
  }
  const abortChild = () => child.abort();
  parent.addEventListener("abort", abortChild, { once: true });
  return () => parent.removeEventListener("abort", abortChild);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const defaultScheduleRenewal: ScheduleRenewal = (callback, delayMs) => {
  const timer = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timer);
};

const defaultWaitForReconnect: WaitForReconnect = (attempt, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", finish);
      globalThis.clearTimeout(timer);
      resolve();
    };
    const timer = globalThis.setTimeout(
      finish,
      computeEarnRealtimeReconnectDelayMs(attempt)
    );
    signal.addEventListener("abort", finish, { once: true });
  });

export async function runEarnRealtimeLifecycle({
  clearCursor,
  consumeStream = consumeEarnRealtimeStream,
  getCursor,
  onConnected,
  onConnecting,
  onError,
  onInvalidation,
  onResyncRequired,
  scheduleRenewal = defaultScheduleRenewal,
  signal,
  tokenCache,
  waitForReconnect = defaultWaitForReconnect,
}: EarnRealtimeLifecycleOptions): Promise<void> {
  let attempt = 0;

  try {
    while (!signal.aborted) {
      onConnecting(attempt > 0);
      try {
        const tokenRequest = new AbortController();
        const unlinkTokenRequest = linkAbortSignal(signal, tokenRequest);
        let token: EarnRealtimeTokenResponse;
        try {
          token = await tokenCache.get(tokenRequest.signal);
        } finally {
          unlinkTokenRequest();
        }
        if (signal.aborted) {
          return;
        }

        const stream = new AbortController();
        const unlinkStream = linkAbortSignal(signal, stream);
        let renewing = false;
        const cancelRenewal = scheduleRenewal(() => {
          renewing = true;
          tokenCache.clear();
          stream.abort();
        }, Math.max(1_000, tokenCache.renewalDelayMs(token)));
        let result: EarnRealtimeStreamResult;
        try {
          result = await consumeStream({
            cursor: getCursor(),
            onConnected: () => {
              attempt = 0;
              onConnected();
            },
            onInvalidation,
            response: token,
            signal: stream.signal,
          });
        } catch (error) {
          if (renewing && isAbortError(error)) {
            attempt = 0;
            continue;
          }
          throw error;
        } finally {
          cancelRenewal();
          unlinkStream();
        }

        if (result.reason === "resync_required") {
          clearCursor();
          await onResyncRequired();
          attempt = 0;
          continue;
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (!isAbortError(error)) {
          onError?.(error);
        }
      }

      attempt += 1;
      await waitForReconnect(attempt - 1, signal);
    }
  } finally {
    tokenCache.clear();
  }
}
