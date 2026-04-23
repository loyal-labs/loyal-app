// Address-poisoning & dust filter predicates.
//
// Attackers commonly send wallets tiny SOL amounts or spam SPL tokens (often
// with lookalike senders or symbols mimicking real assets) to clutter
// activity feeds and trick users into copying the attacker's address when
// they "repeat" a recent interaction. These predicates decide when an
// inbound transfer is small enough to hide from the default activity view.
//
// Never filter user-signed or outgoing transfers — the user chose to do
// that and should see it regardless of amount.
//
// Lives in @loyal-labs/shared (not @loyal-labs/solana-wallet) so mobile —
// which is outside the bun workspace — can consume it without pulling in
// solana-wallet's workspace-only transitive deps.

/**
 * SOL transfers below this many lamports are treated as dust (~0.0001 SOL).
 *
 * Raised from 10_000 → 100_000 after observing address-poisoning spam
 * sending amounts like 10,044 lamports (a deliberately above-10k value
 * to evade a 10k-lamport filter). 100k leaves room for legitimate
 * micro-transfers while catching the bulk of SOL-dust spam patterns.
 */
export const SOL_DUST_THRESHOLD_LAMPORTS = 100_000;

/**
 * SPL token transfers whose *normalized* amount (raw / 10^decimals) is below
 * this value are treated as dust. Chosen so that single-raw-unit pings on
 * 6-decimal stablecoins (the canonical address-poisoning shape, e.g.
 * `0.000001 USDC`) are suppressed, while legit micro-payments like
 * `0.01 USDC` (10,000 raw) still render.
 */
export const TOKEN_DUST_NORMALIZED_THRESHOLD = 0.0001;

export type SolDustInput = {
  /** Did the current wallet sign this transaction? */
  isUserSigned: boolean;
  /** Is there a non-zero token balance change alongside this SOL change? */
  hasTokenChange: boolean;
  /** Net lamport delta on the wallet (signed). */
  lamports: number;
};

/**
 * Suppress SOL-only inbound transfers that nudge the balance by an
 * imperceptible amount — typically rent-exempt dust or spam.
 */
export function isDustSolTransfer(input: SolDustInput): boolean {
  if (input.isUserSigned) return false;
  if (input.hasTokenChange) return false;
  return Math.abs(input.lamports) < SOL_DUST_THRESHOLD_LAMPORTS;
}

export type TokenDustInput = {
  isUserSigned: boolean;
  direction: "in" | "out";
  /** Absolute raw token amount (post-decimal). Must be non-negative. */
  rawAmount: bigint;
  decimals: number;
};

/**
 * Hide inbound token pings whose normalized amount falls under the dust
 * threshold and that the user did not sign.
 */
export function isDustTokenTransfer(input: TokenDustInput): boolean {
  if (input.isUserSigned) return false;
  if (input.direction !== "in") return false;
  if (input.rawAmount <= BigInt(0)) return false;

  const decimals = Math.max(0, input.decimals);
  const divisor = 10 ** decimals;
  const normalized = Number(input.rawAmount) / divisor;
  return normalized < TOKEN_DUST_NORMALIZED_THRESHOLD;
}
