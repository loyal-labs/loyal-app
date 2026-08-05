import { KaminoUpstreamError } from "@loyal-labs/smart-account-vaults";

import {
  isConnectionFailure,
  isConnectionTimeout,
} from "@/lib/network/connection-failure";
// Type-only: a value import from `@/services/observability` would pull the
// storage/native-module graph into this leaf and break its test suite.
import type { LifecycleErrorDetail } from "@/services/observability";

import { earnNetworkError } from "./earn-api";

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
  // The message is matched, not just the TypeError type. This helper wraps
  // whole SDK prepare calls, so a TypeError arriving here is as likely a bug
  // in our own transaction building as a dead socket — and treating one as a
  // network blip retried it three times, then replaced it with an
  // `EarnApiError` telling the user to check their connection while the real
  // fault sat in our code. A bug now throws straight through, message intact.
  if (isConnectionFailure(error)) {
    return true;
  }
  return isKaminoUpstreamError(error) && isRetryableKaminoStatus(error.status);
}

// The exhausted error replaces whatever we were retrying, so without this the
// cause is gone by the time telemetry sees it and a Kamino outage is
// indistinguishable from a phone with no signal (ASK-2018). Kamino is checked
// here rather than in the shared classifier because the retryable-status rule
// lives in this file.
//
// Only the two shapes `isRetryableNetworkError` accepts can reach here, since
// nothing else is ever retried — the undefined return is a safe default, not a
// reachable case.
function exhaustedErrorDetail(
  lastError: unknown,
): LifecycleErrorDetail | undefined {
  if (isKaminoUpstreamError(lastError)) return "kamino_upstream_unavailable";
  // Checked before the broader failure test, which also covers timeouts.
  if (isConnectionTimeout(lastError)) return "request_timeout";
  if (isConnectionFailure(lastError)) return "network_unreachable";
  return undefined;
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
  throw earnNetworkError(exhaustedMessage, exhaustedErrorDetail(lastError));
}
