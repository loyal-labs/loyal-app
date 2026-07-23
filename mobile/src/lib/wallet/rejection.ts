// A user declining or backing out of a wallet prompt is a choice, not a
// failure — telemetry must not report it as an error (ASK-1859).
//
// Each wallet backend signals a decline differently: MWA raises coded protocol
// errors, a torn-down MWA session arrives as a bare native
// CancellationException, Seed Vault returns an Android activity result, and our
// own approval sheet just resolves false. Every one of those paths throws
// `WalletRejectedError` (or a subclass) so callers can ask `isWalletRejection`
// instead of matching error messages.

export class WalletRejectedError extends Error {
  constructor(message = "The signing request was declined.") {
    super(message);
    this.name = "WalletRejectedError";
  }
}

/** True when `error` came from the user declining or dismissing a wallet prompt. */
export function isWalletRejection(error: unknown): boolean {
  return error instanceof WalletRejectedError;
}
