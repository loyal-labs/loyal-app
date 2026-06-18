import { stat } from "node:fs/promises";

type RetryOptions<T> = {
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  maxAttempts?: number;
  onRetry?: (params: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void | Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
  task: () => Promise<T>;
};

export async function hasFile(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export function isTransientError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toUpperCase()
      : String(error).toUpperCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
    return true;
  }

  return (
    message.includes("FLOOD_WAIT") ||
    message.includes("RPC_CALL_FAIL") ||
    message.includes("TIMEOUT") ||
    message.includes("NETWORK")
  );
}

export function parseChatIdsCsv(
  value: string,
  flagName: string = "--chat-ids"
): bigint[] {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new Error(`${flagName} must include at least one chat id`);
  }

  return parsed.map((entry) => {
    try {
      return BigInt(entry);
    } catch {
      throw new Error(`Invalid ${flagName} value: '${entry}'`);
    }
  });
}

export async function runWithRetry<T>(options: RetryOptions<T>): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const isRetryable = options.isRetryable ?? isTransientError;
  const sleepFn = options.sleepFn ?? sleep;

  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("maxAttempts must be a positive integer");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await options.task();
    } catch (error) {
      const shouldRetry = isRetryable(error) && attempt < maxAttempts;
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = baseDelayMs * attempt;
      if (options.onRetry) {
        await options.onRetry({
          attempt,
          delayMs,
          error,
        });
      }
      await sleepFn(delayMs);
    }
  }

  throw new Error("Retry loop exhausted");
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
