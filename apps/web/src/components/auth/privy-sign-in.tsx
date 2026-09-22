"use client";

import { useState } from "react";

import {
  MobileWalletList,
  useNeedsMobileWalletBrowser,
} from "./mobile-wallet-list";
import { usePrivyAuth } from "./privy-session-sync";
import { WalletSignIn } from "./wallet-sign-in";

/** Sign-in modal body when Privy is on. The flow itself lives in
 *  PrivyAuthController so it survives this modal closing. */
export function PrivySignIn() {
  const auth = usePrivyAuth();
  // Hooks run before the early return below.
  const needsMobileWalletBrowser = useNeedsMobileWalletBrowser();
  // Privy's Solana login is SIWS (off-chain message signing), which Ledger's
  // Solana app refuses, so hardware-wallet users need the legacy proof flow
  // and its "I use Ledger" transaction proof.
  const [useLegacyWalletFlow, setUseLegacyWalletFlow] = useState(false);
  if (!auth) return null;
  if (useLegacyWalletFlow) return <WalletSignIn defaultUseLedgerProof />;
  const busy = auth.step !== "idle";
  return (
    <div className="flex flex-col gap-3">
      <button
        className="flex h-12 w-full items-center justify-center rounded-full bg-foreground px-4 font-medium text-background text-sm transition hover:bg-foreground/90 disabled:opacity-60"
        disabled={!auth.ready || busy}
        onClick={auth.start}
        type="button"
      >
        {auth.step === "creating_wallet"
          ? "Creating your wallet…"
          : auth.step === "exchanging"
          ? "Signing in…"
          : "Continue"}
      </button>
      {auth.error ? (
        <p className="text-destructive text-sm">{auth.error}</p>
      ) : null}
      {/* Mobile browsers inject no wallet, so Privy's list has nothing for a
          Phantom/Solflare user: reopen the page in the wallet's own browser,
          where the wallet is injected and Privy detects it. */}
      {needsMobileWalletBrowser ? <MobileWalletList /> : null}
      <button
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        onClick={() => setUseLegacyWalletFlow(true)}
        type="button"
      >
        I use Ledger or hardware wallet
      </button>
    </div>
  );
}
