"use client";

import {
  getIdentityToken,
  useLinkAccount,
  useLogin,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useCreateWallet, useWallets } from "@privy-io/react-auth/solana";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";

type Step = "idle" | "privy" | "creating_wallet" | "exchanging";

type PrivyAuthState = {
  ready: boolean;
  step: Step;
  error: string | null;
  start: () => void;
};

const PrivyAuthContext = createContext<PrivyAuthState | null>(null);
const WANTS_SESSION_KEY = "loyal:privy-wants-session";

export function usePrivyAuth(): PrivyAuthState | null {
  return useContext(PrivyAuthContext);
}

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
 * Owns the Privy <-> Loyal session handshake. Mounted once at layout level so
 * it survives the sign-in modal closing while Privy's own modal is up.
 *
 * - `start()` (from the modal button): open Privy if needed, then once Privy
 *   is authenticated pick the wallet (login wallet -> linked external ->
 *   linked embedded -> create embedded), exchange the identity token for the
 *   Loyal cookie, and select that wallet in wallet-adapter.
 * - Loyal session gone while Privy still authenticated -> Privy logout.
 */
export function PrivyAuthController({ children }: { children: ReactNode }) {
  const { privyAppId } = usePublicEnv();
  if (!privyAppId) return children;
  return <Inner>{children}</Inner>;
}

function Inner({ children }: { children: ReactNode }) {
  const { ready, authenticated, user: privyUser, logout } = usePrivy();
  const { refreshUser } = useUser();
  const { createWallet } = useCreateWallet();
  const { ready: walletsReady, wallets: privyWallets } = useWallets();
  const adapter = useWallet();
  const { isHydrated, isAuthenticated, refreshSession } = useAuthSession();
  const {
    openAccount: openSignInModal,
    close: closeSignInModal,
    registerHandler,
  } = useSignInModal();

  // Wallet-only users get Privy's "Connect your email" modal right after
  // sign-in; on success the Loyal session is re-issued so user.email lands.
  const { linkEmail } = useLinkAccount({
    onSuccess: async ({ user }) => {
      const wallet = user.linkedAccounts.find(
        (a) => a.type === "wallet" && a.chainType === "solana"
      );
      if (!wallet || !("address" in wallet)) return;
      await exchangePrivySession(wallet.address);
      await refreshSession();
    },
  });

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  // OAuth (Google) is a full-page redirect, so the "finish the Loyal sign-in
  // once Privy is authenticated" intent has to survive a reload.
  const [wantsSession, setWantsSessionState] = useState(
    () =>
      typeof window !== "undefined" &&
      sessionStorage.getItem(WANTS_SESSION_KEY) === "1"
  );
  const setWantsSession = useCallback((next: boolean) => {
    setWantsSessionState(next);
    if (next) sessionStorage.setItem(WANTS_SESSION_KEY, "1");
    else sessionStorage.removeItem(WANTS_SESSION_KEY);
  }, []);
  const loginAddressRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const wasAuthenticatedRef = useRef(false);

  const { login } = useLogin({
    onComplete: ({ loginAccount }) => {
      loginAddressRef.current =
        loginAccount && loginAccount.type === "wallet"
          ? loginAccount.address
          : null;
    },
    onError: (code) => {
      setWantsSession(false);
      setStep("idle");
      setError(`Privy login failed: ${code}`);
    },
  });

  const start = useCallback(() => {
    setError(null);
    setWantsSession(true);
    if (!authenticated) {
      setStep("privy");
      login();
    }
  }, [authenticated, login, setWantsSession]);

  // "Connect" anywhere on the page goes straight to Privy while signed out;
  // signed in, the modal shows the Account view as before.
  useEffect(() => {
    registerHandler(() => {
      if (isAuthenticated || !ready) return false;
      start();
      return true;
    });
    return () => registerHandler(null);
  }, [isAuthenticated, ready, registerHandler, start]);

  const completeSignIn = useCallback(async () => {
    if (!privyUser) return;
    const linked = privyUser.linkedAccounts;
    const hasEmail = linked.some(
      (a) => a.type === "email" || a.type === "google_oauth"
    );
    // Only wallets linked to this Privy user count. `privyWallets` also lists
    // wallets merely connected in the browser (e.g. another extension that
    // belongs to a different Privy user).
    const linkedSolana = linked.filter(
      (a) => a.type === "wallet" && a.chainType === "solana"
    );
    const linkedAddresses = new Set(
      linkedSolana.map((a) => ("address" in a ? a.address : ""))
    );
    const external = linkedSolana.find(
      (a) => "walletClientType" in a && a.walletClientType !== "privy"
    );
    const embedded = linkedSolana.find(
      (a) => "walletClientType" in a && a.walletClientType === "privy"
    );
    let address =
      (loginAddressRef.current && linkedAddresses.has(loginAddressRef.current)
        ? loginAddressRef.current
        : null) ??
      (external && "address" in external ? external.address : null) ??
      (embedded && "address" in embedded ? embedded.address : null);
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
    closeSignInModal();
    if (!hasEmail) linkEmail();
  }, [
    adapter,
    closeSignInModal,
    createWallet,
    linkEmail,
    privyUser,
    privyWallets,
    refreshSession,
    refreshUser,
  ]);

  // Sign-in: run once everything is ready, whichever order it arrives in.
  useEffect(() => {
    if (!wantsSession || !authenticated || !walletsReady || !privyUser) return;
    if (isAuthenticated || runningRef.current) return;
    runningRef.current = true;
    void completeSignIn()
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        openSignInModal();
      })
      .finally(() => {
        runningRef.current = false;
        setWantsSession(false);
        setStep("idle");
      });
  }, [
    authenticated,
    completeSignIn,
    isAuthenticated,
    openSignInModal,
    privyUser,
    setWantsSession,
    walletsReady,
    wantsSession,
  ]);

  // Sign-out: Loyal session gone while Privy still authenticated.
  useEffect(() => {
    if (!isHydrated || !ready) return;
    if (isAuthenticated) {
      wasAuthenticatedRef.current = true;
      return;
    }
    if (wasAuthenticatedRef.current && authenticated && !wantsSession) {
      wasAuthenticatedRef.current = false;
      void logout();
    }
  }, [authenticated, isAuthenticated, isHydrated, logout, ready, wantsSession]);

  const value = useMemo(
    () => ({ ready, step, error, start }),
    [ready, step, error, start]
  );
  return (
    <PrivyAuthContext.Provider value={value}>
      {children}
    </PrivyAuthContext.Provider>
  );
}
