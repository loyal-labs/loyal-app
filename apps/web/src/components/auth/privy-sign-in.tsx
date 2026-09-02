"use client";

import { useLogin, usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { useCreateWallet, useWallets } from "@privy-io/react-auth/solana";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useState } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";

type Step = "idle" | "creating_wallet" | "exchanging" | "error";

async function exchangePrivySession(
  identityToken: string,
  walletAddress: string
) {
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
 * Privy sign-in: opens the Privy modal, then exchanges the Privy identity
 * token for the Loyal session and selects the signing wallet in wallet-adapter.
 * - External wallet login (Loyal extension, Phantom, ...) -> that wallet.
 * - Email login with no wallet -> create a Privy embedded wallet first.
 */
export function PrivySignIn() {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { createWallet } = useCreateWallet();
  const { ready: walletsReady, wallets: privyWallets } = useWallets();
  const adapter = useWallet();
  const { refreshSession } = useAuthSession();
  const { close } = useSignInModal();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    address: string | null;
    hasEmail: boolean;
  } | null>(null);

  const finish = useCallback(
    async (walletAddress: string, hasEmail: boolean) => {
      if (!identityToken) throw new Error("Privy identity token unavailable.");
      setStep("exchanging");
      await exchangePrivySession(identityToken, walletAddress);
      // Privy knows which wallet-standard wallet owns the address; the adapter
      // lists the same wallets by name, so hand it the matching one to sign with.
      const owner = privyWallets.find((w) => w.address === walletAddress);
      const entry = owner
        ? adapter.wallets.find(
            (w) => w.adapter.name === owner.standardWallet.name
          )
        : undefined;
      if (entry) {
        adapter.select(entry.adapter.name);
        // Privy just connected this wallet, so the adapter's connect resolves
        // without a prompt; on a first-ever connect (e.g. Jupiter) the wallet
        // may still ask, so wait for it instead of finishing half-connected.
        if (!entry.adapter.connected) {
          await entry.adapter.connect();
        }
      }
      await refreshSession();
      setStep("idle");
      // Wallet-only users have no email yet: keep the modal open so the
      // Account view's "Add your email" card is the first thing they see.
      if (hasEmail) close();
    },
    [adapter, close, identityToken, privyWallets, refreshSession]
  );

  const { login } = useLogin({
    onComplete: ({ user, loginAccount }) => {
      const address =
        loginAccount && loginAccount.type === "wallet"
          ? loginAccount.address
          : null;
      const hasEmail = user.linkedAccounts.some(
        (a) => a.type === "email" || a.type === "google_oauth"
      );
      setPending({ address, hasEmail });
    },
    onError: (code) => {
      setError(`Privy login failed: ${code}`);
      setStep("error");
    },
  });

  // Runs once Privy is authenticated and the identity token + wallets are
  // ready (they arrive a tick after onComplete).
  useEffect(() => {
    if (!pending || !authenticated || !identityToken || !walletsReady) return;
    setPending(null);
    void (async () => {
      try {
        let address = pending.address;
        if (!address) {
          const embedded = privyWallets.find(
            (w) => w.standardWallet.name === "Privy"
          );
          if (embedded) {
            address = embedded.address;
          } else {
            setStep("creating_wallet");
            const { wallet } = await createWallet();
            address = wallet.address;
          }
        }
        await finish(address, pending.hasEmail);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep("error");
      }
    })();
  }, [
    authenticated,
    createWallet,
    finish,
    identityToken,
    pending,
    privyWallets,
    walletsReady,
  ]);

  const busy = step === "creating_wallet" || step === "exchanging";
  return (
    <div className="flex flex-col gap-3">
      <button
        className="flex h-12 w-full items-center justify-center rounded-full bg-foreground px-4 font-medium text-background text-sm transition hover:bg-foreground/90 disabled:opacity-60"
        disabled={!ready || busy}
        onClick={() => {
          setError(null);
          if (authenticated && privyUser) {
            // Privy session survived a Loyal logout/expiry: skip the modal and
            // resume with the wallet Privy already knows (external first).
            const wallet = privyUser.linkedAccounts.find(
              (a) => a.type === "wallet" && a.chainType === "solana"
            );
            setPending({
              address: wallet && "address" in wallet ? wallet.address : null,
              hasEmail: privyUser.linkedAccounts.some(
                (a) => a.type === "email" || a.type === "google_oauth"
              ),
            });
            return;
          }
          login();
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
