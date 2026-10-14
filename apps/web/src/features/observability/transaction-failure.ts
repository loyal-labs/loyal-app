import type { LifecycleErrorCode } from "./lifecycle-contract";

// Classify before executors replace SDK errors with user-facing copy.
export function classifyTransactionFailure(error: unknown): LifecycleErrorCode {
  if (!error || typeof error !== "object") return "unexpected_error";
  if (
    "transactionWasSubmitted" in error &&
    error.transactionWasSubmitted === true
  ) {
    return "unconfirmed_signature";
  }
  if ("code" in error && error.code === 4001) return "wallet_rejected";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (
    /user (?:rejected|denied|declined|cancelled|canceled)|request rejected by user/i.test(
      message
    )
  ) {
    return "wallet_rejected";
  }
  if (/SimulationError$/.test(name) || /simulation failed/i.test(message)) {
    return "simulation_failed";
  }
  return "unexpected_error";
}
