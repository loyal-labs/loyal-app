"use client";

import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { usePublicEnv } from "@/contexts/public-env-context";

// Privy's Solana login is SIWS (off-chain message signing), which Ledger's
// Solana app refuses, and Privy's modal cannot carry our own option. So the
// Ledger path is offered next to Connect, on the page, and opens our modal
// on the legacy transaction-proof flow.
export function LedgerSignInLink({ className }: { className?: string }) {
  const { privyAppId } = usePublicEnv();
  const { openLedger } = useSignInModal();
  if (!privyAppId) return null;
  return (
    <button
      className={`text-muted-foreground text-sm underline-offset-4 hover:underline ${
        className ?? ""
      }`}
      onClick={openLedger}
      type="button"
    >
      Using Ledger?
    </button>
  );
}
