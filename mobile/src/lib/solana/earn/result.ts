// Bridges a just-completed deposit from the deposit-process screen back to the
// Earn tab so it can show its funded state immediately. This is interim: once
// the on-chain Earn position read-model is wired, the Earn screen derives its
// balance from that instead of this signal.
let pendingDepositUsd: number | null = null;

export function markEarnDeposited(amountUsd: number): void {
  pendingDepositUsd = amountUsd;
}

// Returns the pending deposit amount once, then clears it.
export function takePendingEarnDeposit(): number | null {
  const value = pendingDepositUsd;
  pendingDepositUsd = null;
  return value;
}
