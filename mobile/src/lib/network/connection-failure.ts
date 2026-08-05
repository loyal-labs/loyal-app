// Lives in this dependency-free leaf so both the retry helper and the
// telemetry classifier can share one definition: a value import from
// `@/services/observability` would pull the storage/native-module graph into
// `lib/solana/earn/connection-retry` and break its test suite.

// The two — and only two — TypeErrors RN's fetch rejects with for a
// connection-level failure, from the whatwg-fetch polyfill's `xhr.onerror` and
// `xhr.ontimeout` handlers. `xhr.onabort` rejects with a DOMException instead,
// which `fetchWithTimeout` already turns into a FetchTimeoutError.
//
// Matching both matters: keying on "failed" alone would classify every stalled
// request as a bug in our own code and route it to the sanitized error ingest,
// which is exactly the flood that ingest is kept clear of.
const CONNECTION_FAILED = /network request failed/i;
const CONNECTION_TIMED_OUT = /network request timed out/i;

/**
 * Whether an error is a connection-level fetch failure — DNS, TLS, a reset
 * socket, or a stalled request.
 *
 * The message is matched, not just the type, and that is the whole point: the
 * code paths this guards also run our own transaction-building, where a
 * TypeError means a bug in it. Calling that an unreachable network would send
 * on-call looking at connectivity while the real fault sits in our code.
 */
export function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return (
    CONNECTION_FAILED.test(error.message) ||
    CONNECTION_TIMED_OUT.test(error.message)
  );
}

/** The stalled-request half of {@link isConnectionFailure}. */
export function isConnectionTimeout(error: unknown): boolean {
  return error instanceof TypeError && CONNECTION_TIMED_OUT.test(error.message);
}
