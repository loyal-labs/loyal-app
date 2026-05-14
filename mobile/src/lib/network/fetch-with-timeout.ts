// React Native's fetch has no default timeout — a dead socket will sit
// indefinitely, which is how the wallet pull-to-refresh used to hang
// forever when any one of the three parallel requests stalled. This
// wrapper wires an AbortController so a stalled request rejects with
// AbortError after `timeoutMs`, making the calling code's existing
// try/catch actually reachable.
//
// Callers that need their own AbortSignal can pass it via `init.signal`;
// we chain both signals so aborts from either side cancel the request.

const DEFAULT_TIMEOUT_MS = 12_000;

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Fetch to ${url} timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...rest } =
    init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const externalAbortHandler = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", externalAbortHandler);
    }
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError" &&
      !externalSignal?.aborted
    ) {
      const url = typeof input === "string" ? input : input.url;
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", externalAbortHandler);
    }
  }
}
