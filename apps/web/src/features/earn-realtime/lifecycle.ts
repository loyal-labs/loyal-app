import {
  consumeEarnRealtimeStream,
  isEarnRealtimeAuthRejection,
  type EarnRealtimeStreamResult,
  type EarnRealtimeTokenResponse,
} from "./stream";
import { waitForEarnRealtimeRecovery } from "./recovery";
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
  onCursorlessConnected: () => Promise<void> | void;
  onError?: (error: unknown) => void;
  onInvalidation: (event: EarnRealtimeInvalidation) => void;
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
  waitForEarnRealtimeRecovery({ attempt, signal });

export async function runEarnRealtimeLifecycle({
  clearCursor,
  consumeStream = consumeEarnRealtimeStream,
  getCursor,
  onConnected,
  onConnecting,
  onCursorlessConnected,
  onError,
  onInvalidation,
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
        const cursor = getCursor();
        let admitted = false;
        let streamOpen = true;
        let admissionPromise: Promise<void> | null = null;
        try {
          result = await consumeStream({
            cursor,
            onConnected: () => {
              if (cursor !== null) {
                attempt = 0;
                admitted = true;
                onConnected();
                return;
              }

              admissionPromise = Promise.resolve()
                .then(onCursorlessConnected)
                .then(() => {
                  if (streamOpen && !stream.signal.aborted && !signal.aborted) {
                    attempt = 0;
                    admitted = true;
                    onConnected();
                  }
                })
                .catch((error) => {
                  onError?.(error);
                  stream.abort();
                });
            },
            onInvalidation,
            response: token,
            signal: stream.signal,
          });
          streamOpen = false;
          stream.abort();
          if (admissionPromise && !signal.aborted) {
            await admissionPromise;
          }
        } catch (error) {
          streamOpen = false;
          stream.abort();
          if (admissionPromise && !signal.aborted) {
            await admissionPromise;
          }
          if (renewing && isAbortError(error)) {
            if (admitted) attempt = 0;
            continue;
          }
          if (isEarnRealtimeAuthRejection(error)) {
            tokenCache.clear();
          }
          throw error;
        } finally {
          streamOpen = false;
          stream.abort();
          cancelRenewal();
          unlinkStream();
        }

        if (result.reason === "resync_required") {
          clearCursor();
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

      if (signal.aborted) return;
      onConnecting(true);
      attempt += 1;
      await waitForReconnect(attempt - 1, signal);
    }
  } finally {
    tokenCache.clear();
  }
}
