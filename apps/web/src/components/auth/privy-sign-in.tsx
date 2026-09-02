"use client";

import {
  getIdentityToken,
  useLogin,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useCreateWallet, useWallets } from "@privy-io/react-auth/solana";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";

type Step = "idle" | "creating_wallet" | "exchanging" | "error";

async function exchangePrivySession(walletAddress: string) {
  const identityToken = await getIdentityToken();
  if (!identityToken) throw new Error("Privy identity token unavailable.");
  const res = await fetch("/api/auth/privy/complete", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "privy-id-token": identityToken,
    },
    body: JSON.stringify({ walletAddress }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Sign-in failed (${res.status})`);
  }
}

/**
 * Privy sign-in. One button:
 * 1. If Privy is not authenticated, open the Privy modal (email or wallet).
 * 2. Once Privy is authenticated (now or from a previous visit), pick the
 *    wallet: the one used to log in, else an existing linked wallet, else
 *    create an embedded wallet.
 * 3. Exchange the Privy identity token for the Loyal session cookie and
 *    select that wallet in wallet-adapter so the app can sign with it.
 * Step 2-3 run from an effect keyed on `authenticated`, so they do not depend
 * on Privy's onComplete timing.
 */
export function PrivySignIn() {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const { refreshUser } = useUser();
  const { createWallet } = useCreateWallet();
  const { ready: walletsReady, wallets: privyWallets } = useWallets();
  const adapter = useWallet();
  const { isAuthenticated, refreshSession } = useAuthSession();
  const { close } = useSignInModal();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  // Set when the user clicks Continue; cleared when the exchange finishes.
  const [wantsSession, setWantsSession] = useState(false);
  const loginAddressRef = useRef<string | null>(null);
  const runningRef = useRef(false);

  const { login } = useLogin({
    onComplete: ({ loginAccount }) => {
      loginAddressRef.current =
        loginAccount && loginAccount.type === "wallet"
          ? loginAccount.address
          : null;
    },
    onError: (code) => {
      setWantsSession(false);
      setError(`Privy login failed: ${code}`);
      setStep("error");
    },
  });

  const completeSignIn = useCallback(async () => {
    if (!privyUser) return;
    const linked = privyUser.linkedAccounts;
    const hasEmail = linked.some(
      (a) => a.type === "email" || a.type === "google_oauth"
    );
    let address =
      loginAddressRef.current ??
      privyWallets.find((w) => w.standardWallet.name !== "Privy")?.address ??
      privyWallets.find((w) => w.standardWallet.name === "Privy")?.address ??
      null;
    loginAddressRef.current = null;

    if (!address) {
      setStep("creating_wallet");
      const { wallet } = await createWallet();
      address = wallet.address;
      // Re-issue the identity token so it lists the new wallet.
      await refreshUser();
    }

    setStep("exchanging");
    await exchangePrivySession(address);

    // Privy knows which wallet-standard wallet owns the address; the adapter
    // lists the same wallets by name, so hand it the matching one to sign with.
    const owner = privyWallets.find((w) => w.address === address);
    const entry = owner
      ? adapter.wallets.find(
          (w) => w.adapter.name === owner.standardWallet.name
        )
      : undefined;
    if (entry) {
      adapter.select(entry.adapter.name);
      if (!entry.adapter.connected) {
        await entry.adapter.connect();
      }
    }
    await refreshSession();
    setStep("idle");
    // Wallet-only users have no email yet: keep the modal open so the
    // Account view's "Add your email" card is the first thing they see.
    if (hasEmail) close();
  }, [
    adapter,
    close,
    createWallet,
    privyUser,
    privyWallets,
    refreshSession,
    refreshUser,
  ]);

  useEffect(() => {
    if (!wantsSession || !authenticated || !walletsReady || !privyUser) return;
    if (isAuthenticated || runningRef.current) return;
    runningRef.current = true;
    void completeSignIn()
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setStep("error");
      })
      .finally(() => {
        runningRef.current = false;
        setWantsSession(false);
      });
  }, [
    authenticated,
    completeSignIn,
    isAuthenticated,
    privyUser,
    walletsReady,
    wantsSession,
  ]);

  const busy = step === "creating_wallet" || step === "exchanging";
  return (
    <div className="flex flex-col gap-3">
      <button
        className="flex h-12 w-full items-center justify-center rounded-full bg-foreground px-4 font-medium text-background text-sm transition hover:bg-foreground/90 disabled:opacity-60"
        disabled={!ready || busy}
        onClick={() => {
          setError(null);
          setWantsSession(true);
          if (!authenticated) login();
        }}
        type="button"
      >
        {step === "creating_wallet"
          ? "Creating your wallet…"
          : step === "exchanging"
          ? "Signing in…"
          : "Continue"}
      </button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
