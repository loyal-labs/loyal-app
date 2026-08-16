export type WithdrawSubmitLock = {
  current: boolean;
};

/**
 * Acquire the withdrawal lock synchronously, before React can render updated
 * button state. The release callback is idempotent so every exit path can use
 * the same `finally` block safely.
 */
export function acquireWithdrawSubmitLock(
  lock: WithdrawSubmitLock,
): (() => void) | null {
  if (lock.current) {
    return null;
  }

  lock.current = true;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    lock.current = false;
  };
}
