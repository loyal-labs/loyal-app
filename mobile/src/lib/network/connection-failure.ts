// Lives in this dependency-free leaf so both the retry helper and the
// telemetry classifier can share one definition: a value import from
// `@/services/observability` would pull the storage/native-module graph into
// `lib/solana/earn/connection-retry` and break its test suite.

/**
 * Whether an error is a connection-level fetch failure — DNS, TLS, a reset
 * socket — which React Native surfaces as TypeError("Network request failed").
 *
 * The message is matched, not just the type, and that is the whole point: the
 * code paths this guards also run our own transaction-building, where a
 * TypeError means a bug in it. Calling that an unreachable network would send
 * on-call looking at connectivity while the real fault sits in our code.
 */
export function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof TypeError && /network request failed/i.test(error.message)
  );
}
