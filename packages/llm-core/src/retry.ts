import { LlmRetryExhaustedError } from "./errors";
import type { RetryPolicy } from "./types";
import { getErrorMessage } from "./validation";

const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_INITIAL_DELAY_MS = 150;
const DEFAULT_JITTER_RATIO = 0.2;
const DEFAULT_MAX_DELAY_MS = 2_000;

export type RetryAttemptFailure = {
  attempt: number;
  error: unknown;
  maxAttempts: number;
  reason: string;
};

export type RetryRunResult<T> = {
  attempts: number;
  failureReasons: string[];
  value: T;
};

export type RunWithRetryPolicyParams<T> = {
  label: string;
  onAttemptFailure?: (failure: RetryAttemptFailure) => void;
  policy: RetryPolicy;
  shouldRetry?: (error: unknown) => boolean;
  task: (attempt: number) => Promise<T>;
};

export async function runWithRetryPolicy<T>(
  params: RunWithRetryPolicyParams<T>
): Promise<RetryRunResult<T>> {
  const { label, onAttemptFailure, policy, shouldRetry, task } = params;
  const failureReasons: string[] = [];

  const maxAttempts = Math.max(1, policy.maxAttempts);
  const backoffMultiplier =
    policy.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const initialDelayMs = policy.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const jitterRatio = policy.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const maxDelayMs = policy.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let nextDelayMs = initialDelayMs;
  let lastError: unknown;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      const value = await task(attempt);
      return {
        attempts: attempt,
        failureReasons,
        value,
      };
    } catch (error) {
      lastError = error;
      const reason = getErrorMessage(error);
      failureReasons.push(reason);
      onAttemptFailure?.({ attempt, error, maxAttempts, reason });

      const retryable = shouldRetry ? shouldRetry(error) : true;
      const isLastAttempt = attempt === maxAttempts;
      if (!retryable) {
        throw error;
      }

      if (isLastAttempt) {
        break;
      }

      const jitter = nextDelayMs * jitterRatio;
      const jitteredDelay = Math.max(
        0,
        Math.round(nextDelayMs + (Math.random() * 2 - 1) * jitter)
      );

      await sleep(jitteredDelay);
      nextDelayMs = Math.min(
        maxDelayMs,
        Math.round(nextDelayMs * backoffMultiplier)
      );
    }
  }

  const lastReason = getErrorMessage(lastError);

  throw new LlmRetryExhaustedError(
    `${label} failed after ${attemptsMade} attempts: ${lastReason}`,
    {
      attempts: attemptsMade,
      details: {
        lastError: lastReason,
      },
      failureReasons,
    }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
