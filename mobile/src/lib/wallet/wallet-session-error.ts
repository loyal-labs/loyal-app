// A wallet session that never carried our request is not a request failure
// (ASK-1872). The MWA native module rejects every session-level problem with a
// string `code`, and lifecycle telemetry maps *any* coded error to
// `request_failed` — so "the wallet app never connected back" reached ClickStack
// looking exactly like "the backend returned 500", and paged on-call for a
// failure that never left the device.
//
// The native module's rejection codes (SolanaMobileWalletAdapterModule.kt) are:
//
//   ERROR_WALLET_NOT_FOUND                                  no wallet installed
//   "Timed out waiting for local association to be ready"    10s association wait
//   "Session not established: Local association cancelled…"  user backed out
//   "Timed out waiting for response"                         90s in-session wait
//   EUNSPECIFIED                                             everything else,
//     including the ExecutionException raised when the wallet app never
//     connects back to the local association socket
//
// Every one of those throws `WalletSessionError` so callers can ask
// `isWalletSessionError` instead of matching codes, and telemetry can report
// the actual failure instead of a blanket `request_failed`.

export type WalletSessionFailure =
  /** No MWA-capable wallet app is installed. */
  | "unavailable"
  /** The wallet app never connected back — the session never opened. */
  | "connection_failed"
  /** The wallet app was reachable but did not answer in time. */
  | "timeout"
  /** The session opened; the wallet errored while producing the signature. */
  | "signing_failed";

// What the user is told, per failure. Owned here so the advice can never drift
// from the reason: telling someone to update a wallet app that simply was not
// running sends them down the wrong path.
const WALLET_SESSION_MESSAGES: Record<WalletSessionFailure, string> = {
  connection_failed:
    "Couldn't reach your wallet app. Open it once so it's running, then try again.",
  signing_failed:
    "Your wallet app couldn't sign the request. Try again, and update the wallet app if this keeps happening.",
  timeout:
    "Your wallet app didn't respond in time. Try again with it already open.",
  unavailable:
    "No compatible Solana wallet app was found. Install Phantom or Solflare and try again.",
};

export class WalletSessionError extends Error {
  readonly failure: WalletSessionFailure;
  /**
   * The wallet backend's own code, kept for local logs only. Telemetry cannot
   * carry it yet: the ingest rejects envelopes with unknown keys, so until the
   * backend contract gains a field for it the failure discriminant above is
   * what reaches ClickStack.
   */
  readonly walletCode?: string | number;

  constructor(
    failure: WalletSessionFailure,
    walletCode?: string | number,
    // The native rejection this replaces. The message is user-facing copy, so
    // without this the original message and stack would be lost to debugging.
    cause?: unknown,
  ) {
    super(
      WALLET_SESSION_MESSAGES[failure],
      cause === undefined ? undefined : { cause },
    );
    this.name = "WalletSessionError";
    this.failure = failure;
    this.walletCode = walletCode;
  }
}

/** True when `error` is a wallet session that failed before or during signing. */
export function isWalletSessionError(
  error: unknown,
): error is WalletSessionError {
  return error instanceof WalletSessionError;
}
