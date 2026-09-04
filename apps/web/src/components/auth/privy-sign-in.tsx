"use client";

import { usePrivyAuth } from "./privy-session-sync";

/** Sign-in modal body when Privy is on. The flow itself lives in
 *  PrivyAuthController so it survives this modal closing. */
export function PrivySignIn() {
  const auth = usePrivyAuth();
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
    </div>
  );
}
