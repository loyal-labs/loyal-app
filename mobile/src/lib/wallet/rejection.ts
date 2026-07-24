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
  /**
   * Transactions that already landed on-chain before the decline. Non-empty
   * only for multi-prompt flows (MWA signs each step in its own session), where
   * declining a later step leaves earlier steps confirmed and unrecorded. Such
   * a decline is NOT a clean cancellation — see `hasLandedProgress`.
   */
  readonly landedSignatures: readonly string[];

  constructor(
    message = "The signing request was declined.",
    landedSignatures: readonly string[] = [],
  ) {
    super(message);
    this.name = "WalletRejectedError";
    this.landedSignatures = landedSignatures;
  }
}

/** True when `error` came from the user declining or dismissing a wallet prompt. */
export function isWalletRejection(error: unknown): boolean {
  return error instanceof WalletRejectedError;
}

/**
 * True when the user declined *after* part of the flow already landed on-chain.
 * Those cases must stay loud: money moved and no confirm recorded it, so they
 * need the same on-call attention as a hard failure.
 */
export function hasLandedProgress(error: unknown): boolean {
  return error instanceof WalletRejectedError && error.landedSignatures.length > 0;
}

/** Re-raise a rejection carrying the steps that landed before the decline. */
export function withLandedSignatures(
  error: WalletRejectedError,
  landedSignatures: readonly string[],
): WalletRejectedError {
  const tagged = new WalletRejectedError(error.message, landedSignatures);
  // Keep the subclass name and original stack so logs still point at the
  // wallet backend that raised the decline.
  tagged.name = error.name;
  tagged.stack = error.stack;
  return tagged;
}
