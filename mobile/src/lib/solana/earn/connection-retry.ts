import { KaminoUpstreamError } from "@loyal-labs/smart-account-vaults";

import { EarnApiError } from "./earn-api";

// RN surfaces connection-level fetch failures (DNS/TLS/socket reset) as a bare
// TypeError("Network request failed") — which used to reach the Earn sheets
// verbatim (ASK-1801). Prepare stages are read-only on both the backend and
// the RPC, so retrying them is always safe; send/confirm stages keep their
// own semantics and are deliberately NOT wrapped.
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_DELAY_MS = 1_000;

// Device prepare calls Kamino's instruction API directly (RN bypasses the web
// proxy), once per reserve — so a full exit fans out several of these and any
// one transient failure used to sink the whole prepare, which is where the
// ~24 % full-exit prepare failure rate came from (ASK-1887). 5xx and 429 are
// the upstream having a bad moment; a 4xx is a rejected request and will be
// rejected identically on every retry.
function isRetryableKaminoStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

// Metro can resolve a workspace package to more than one module instance, and
// a second copy would make `instanceof` quietly false — so brand-check by name
// as well. Both arms require a numeric `status`, so nothing else matches.
function isKaminoUpstreamError(
  error: unknown,
): error is { status: number } & Error {
  if (error instanceof KaminoUpstreamError) {
    return true;
  }
  return (
    error instanceof Error &&
    error.name === "KaminoUpstreamError" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function isRetryableNetworkError(error: unknown): error is Error {
  // fetch rejects with TypeError only for connection-level failures;
  // API rejections are EarnApiError and SDK/build errors are plain Error.
  if (error instanceof TypeError) {
    return true;
  }
  return isKaminoUpstreamError(error) && isRetryableKaminoStatus(error.status);
}

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
      if (!isRetryableNetworkError(error)) {
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
