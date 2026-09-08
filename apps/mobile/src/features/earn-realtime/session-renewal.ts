import { useSyncExternalStore } from "react";

// The stream owns auth lifecycle; the Earn screen offers the deliberate wallet
// approval. Never call an external signer just because the app became active.
let renewal: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();
export function setEarnSessionRenewal(next: (() => Promise<void>) | null) {
  renewal = next;
  for (const listener of listeners) listener();
}
export function useEarnSessionRenewal() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => renewal,
    () => null
  );
}
