// A wallet at 0 lamports does not exist on-chain, so a transaction naming it
// as fee payer cannot even be simulated: the RPC answers with a bare
// "AccountNotFound" before any instruction runs. One user hit exactly this —
// a send-max SOL transfer emptied the wallet, and every Earn withdraw prepare
// after it died in prefix simulation with that opaque error, reported at
// telemetry's `unexpected_error` severity (ASK-2107). This module owns the
// user-facing shape of that condition so flows can fail fast with advice,
// under its own lifecycle code (`insufficient_native_sol`).

import type { Connection, PublicKey } from "@solana/web3.js";

export class InsufficientSolError extends Error {
  constructor() {
    super(
      "Your wallet needs a little SOL to pay Solana network fees. Your funds are safe — add SOL and try again.",
    );
    this.name = "InsufficientSolError";
  }
}

/** True when `error` is the wallet-can't-fee-pay condition above. */
export function isInsufficientSolError(
  error: unknown,
): error is InsufficientSolError {
  return error instanceof InsufficientSolError;
}

// Fails ONLY on evidence: an RPC error here must not block a flow the real
// prepare path might still complete — the guard exists to convert one known
// dead end into advice, not to add a new way to fail.
export async function assertSolForFees(
  connection: Connection,
  owner: PublicKey,
  minLamports: number,
): Promise<void> {
  let lamports: number;
  try {
    lamports = await connection.getBalance(owner);
  } catch {
    return;
  }
  if (lamports < minLamports) {
    throw new InsufficientSolError();
  }
}
