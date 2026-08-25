// A wallet at 0 lamports does not exist on-chain, so a transaction naming it
// as fee payer cannot even be simulated: the RPC answers with a bare
// "AccountNotFound" before any instruction runs. One user hit exactly this —
// a send-max SOL transfer emptied the wallet, and every Earn withdraw prepare
// after it died in prefix simulation with that opaque error, reported at
// telemetry's `unexpected_error` severity (ASK-2107). This module owns the
// user-facing shape of that condition so flows can fail fast with advice,
// under its own lifecycle code (`insufficient_native_sol`).

import type { SmartAccountNativeSolRequirement } from "@loyal-labs/smart-account-vaults";
import type { Connection, PublicKey } from "@solana/web3.js";

const LAMPORTS_PER_SOL = BigInt(1_000_000_000);

function formatLamports(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;
  if (fraction === BigInt(0)) return whole.toString();
  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

export class InsufficientSolError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Your wallet needs a little SOL to pay Solana network fees. Your funds are safe. Add SOL and try again.",
    );
    this.name = "InsufficientSolError";
  }
}

/** True when `error` is the wallet-can't-fee-pay condition above. */
export function isInsufficientSolError(
  error: unknown,
): error is InsufficientSolError {
  return (
    error instanceof InsufficientSolError ||
    (error instanceof Error && error.name === "InsufficientSolError")
  );
}

/** Block a prepared Earn action before the wallet sees an underfunded tx. */
export function assertNativeSolRequirement(
  requirement: SmartAccountNativeSolRequirement | null | undefined,
): void {
  if (!requirement || requirement.canProceed) return;

  const deficitLamports = BigInt(requirement.deficitLamports);
  if (deficitLamports <= BigInt(0)) return;

  throw new InsufficientSolError(
    `Add at least ${formatLamports(
      deficitLamports,
    )} SOL to your wallet before depositing. This Earn setup needs ${formatLamports(
      BigInt(requirement.requiredLamports),
    )} SOL for account rent and network fees.`,
  );
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
