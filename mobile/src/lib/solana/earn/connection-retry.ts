import { EarnApiError } from "./earn-api";

// RN surfaces connection-level fetch failures (DNS/TLS/socket reset) as a bare
// TypeError("Network request failed") — which used to reach the Earn sheets
// verbatim (ASK-1801). Prepare stages are read-only on both the backend and
// the RPC, so retrying them is always safe; send/confirm stages keep their
// own semantics and are deliberately NOT wrapped.
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_DELAY_MS = 1_000;

export async function withConnectionRetry<T>(
  label: string,
  exhaustedMessage: string,
  run: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < NETWORK_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, NETWORK_RETRY_DELAY_MS),
      );
    }
    try {
      return await run();
    } catch (error) {
      // fetch rejects with TypeError only for connection-level failures;
      // API rejections are EarnApiError and SDK/build errors are plain Error.
      if (!(error instanceof TypeError)) {
        throw error;
      }
      lastError = error;
      console.warn(`[earn] ${label}: network failure`, {
        attempt: attempt + 1,
        errorMessage: error.message,
      });
    }
  }
  console.warn(`[earn] ${label}: giving up after network failures`, {
    errorMessage:
      lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw new EarnApiError(exhaustedMessage);
}
