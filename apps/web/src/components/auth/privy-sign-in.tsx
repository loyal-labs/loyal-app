"use client";

import {
  MobileWalletList,
  useNeedsMobileWalletBrowser,
} from "./mobile-wallet-list";
import { usePrivyAuth } from "./privy-session-sync";

/** Sign-in modal body when Privy is on. The flow itself lives in
 *  PrivyAuthController so it survives this modal closing. */
export function PrivySignIn() {
  const auth = usePrivyAuth();
  // Hooks run before the early return below.
  const needsMobileWalletBrowser = useNeedsMobileWalletBrowser();
  if (!auth) return null;
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
    </div>
  );
}
