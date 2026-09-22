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
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";
import { createBrowserLifecycleTracker } from "@/features/observability/client";
import {
  lifecycleErrorMessage,
  type LifecycleTracker,
  normalizeLifecycleErrorCode,
} from "@/features/observability/lifecycle-contract";

import { useNeedsMobileWalletBrowser } from "./mobile-wallet-list";

type Step = "idle" | "privy" | "creating_wallet" | "exchanging";

type PrivyAuthState = {
  ready: boolean;
  step: Step;
  error: string | null;
  start: () => void;
  // Signed in through the legacy wallet flow (no Privy user yet): log the
  // same wallet into Privy, re-issue the session, then prompt for email.
  addEmail: () => void;
};

const PrivyAuthContext = createContext<PrivyAuthState | null>(null);
const WANTS_SESSION_KEY = "loyal:privy-wants-session";

export function usePrivyAuth(): PrivyAuthState | null {
  return useContext(PrivyAuthContext);
}

export async function exchangePrivySession(
  walletAddress: string,
  flowId?: string
) {
  const identityToken = await getIdentityToken();
  if (!identityToken) throw new Error("Privy identity token unavailable.");
  const res = await fetch("/api/auth/privy/complete", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "privy-id-token": identityToken,
      // Joins the route's smart-account provisioning events to this flow.
      ...(flowId ? { "x-loyal-flow-id": flowId } : {}),
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
  const isCherryEmbedded = useCherryRuntime().mode === "cherry_embedded";
  const needsMobileWalletBrowser = useNeedsMobileWalletBrowser();
  const { refreshUser } = useUser();
  const { createWallet } = useCreateWallet();
  const { ready: walletsReady, wallets: privyWallets } = useWallets();
  const adapter = useWallet();
  const { isHydrated, isAuthenticated, refreshSession, user } =
    useAuthSession();
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
      return;
    }
    // Privy is already authenticated (the Google redirect lands here, and so
    // does every retry after a failed handshake), so login() would open
    // nothing. Show our modal instead: the effect below reports the step and
    // any error there, and without it the click is swallowed silently.
    openSignInModal();
  }, [authenticated, login, openSignInModal, setWantsSession]);

  const addEmail = useCallback(() => {
    if (authenticated) {
      linkEmail();
      return;
    }
    setError(null);
    setWantsSession(true);
    setStep("privy");
    login({ loginMethods: ["wallet"], walletChainType: "solana-only" });
  }, [authenticated, linkEmail, login, setWantsSession]);

  // "Connect" anywhere on the page goes straight to Privy while signed out;
  // signed in, the modal shows the Account view as before. Cherry never opens
  // the Privy modal: features/cherry/client/privy-sign-in owns that path.
  useEffect(() => {
    if (isCherryEmbedded) return;
    registerHandler(() => {
      if (isAuthenticated || !ready) return false;
      // A mobile browser injects no wallet, so Privy's list would offer a
      // Phantom/Solflare user nothing. Fall through to our modal: it keeps
      // the Privy button and adds the links that reopen this page inside the
      // wallet's own browser.
      if (needsMobileWalletBrowser) return false;
      start();
      return true;
    });
    return () => registerHandler(null);
  }, [
    isAuthenticated,
    isCherryEmbedded,
    needsMobileWalletBrowser,
    ready,
    registerHandler,
    start,
  ]);

  const completeSignIn = useCallback(
    async (lifecycle: LifecycleTracker) => {
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

      // Add-email from a legacy session: Privy must have been logged in with
      // the wallet that session is on, else we'd silently switch accounts.
      if (user?.walletAddress) {
        if (!linkedAddresses.has(user.walletAddress)) {
          await logout();
          const short = `${user.walletAddress.slice(
            0,
            4
          )}…${user.walletAddress.slice(-4)}`;
          throw new Error(`Sign in with ${short} to add an email.`);
        }
        address = user.walletAddress;
      }

      if (!address) {
        setStep("creating_wallet");
        lifecycle.observe("wallet_connect");
        // A previous attempt may have created the wallet already and failed
        // after it, so re-read the user first. Every extra wallet also
        // provisions its own sponsored smart account, and repeated creation is
        // what trips Privy's rate limit.
        const refreshed = await refreshUser();
        const existing = refreshed.linkedAccounts.find(
          (a) => a.type === "wallet" && a.chainType === "solana"
        );
        if (existing && "address" in existing) {
          address = existing.address;
        } else {
          const { wallet } = await createWallet();
          address = wallet.address;
          // Re-issue the identity token so it lists the new wallet.
          await refreshUser();
        }
      }

      setStep("exchanging");
      lifecycle.observe("completion");
      await exchangePrivySession(address, lifecycle.flowId);

      // The exchange sets the session cookie, so commit the UI before touching
      // the wallet adapter: a connect that hangs or rejects used to leave the
      // user signed in on the server and signed out in the browser, with the
      // sign-in button dead until a reload.
      lifecycle.observe("session_refresh");
      await refreshSession();
      closeSignInModal();

      // Privy knows which wallet-standard wallet owns the address; the adapter
      // lists the same wallets by name, so hand it the matching one to sign
      // with. Best-effort: the reselect effect below retries on every render
      // once Privy's wallet list catches up.
      const owner = privyWallets.find((w) => w.address === address);
      const entry = owner
        ? adapter.wallets.find(
            (w) => w.adapter.name === owner.standardWallet.name
          )
        : undefined;
      if (entry) {
        adapter.select(entry.adapter.name);
        if (!entry.adapter.connected) {
          await entry.adapter.connect().catch(() => undefined);
        }
      }
      lifecycle.complete("ui_commit");
      if (!hasEmail) linkEmail();
    },
    [
      adapter,
      closeSignInModal,
      createWallet,
      linkEmail,
      logout,
      privyUser,
      privyWallets,
      refreshSession,
      refreshUser,
      user?.walletAddress,
    ]
  );

  // Sign-in: run once everything is ready, whichever order it arrives in.
  useEffect(() => {
    if (!wantsSession || !authenticated || !walletsReady || !privyUser) return;
    if (runningRef.current) return;
    runningRef.current = true;
    const lifecycle = createBrowserLifecycleTracker({
      flowName: "auth.sign_in",
      flowVariant: "interactive",
    });
    lifecycle.start("intent");
    void completeSignIn(lifecycle)
      .catch((e: unknown) => {
        lifecycle.fail("completion", {
          errorCode: normalizeLifecycleErrorCode(
            e && typeof e === "object" && "code" in e
              ? (e as { code?: unknown }).code
              : undefined
          ),
          errorMessage: lifecycleErrorMessage(e),
        });
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
    openSignInModal,
    privyUser,
    setWantsSession,
    walletsReady,
    wantsSession,
  ]);

  // Reload: the Loyal session names a wallet, but wallet-adapter starts
  // disconnected (or on whatever it auto-connected to). Earn actions require
  // the connected wallet to equal the session wallet, so re-select the one
  // Privy says owns the address — same step completeSignIn does at login.
  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !walletsReady) return;
    const address = user?.walletAddress;
    if (!address || adapter.publicKey?.toBase58() === address) return;
    if (adapter.connecting) return;
    const owner = privyWallets.find((w) => w.address === address);
    const entry = owner
      ? adapter.wallets.find(
          (w) => w.adapter.name === owner.standardWallet.name
        )
      : undefined;
    if (!entry) return;
    if (adapter.wallet?.adapter.name !== entry.adapter.name) {
      adapter.select(entry.adapter.name);
      return; // effect re-runs once the selection lands
    }
    if (!adapter.connected) {
      void adapter.connect().catch(() => undefined);
    }
  }, [
    adapter,
    isAuthenticated,
    isHydrated,
    privyWallets,
    user?.walletAddress,
    walletsReady,
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
    () => ({ ready, step, error, start, addEmail }),
    [ready, step, error, start, addEmail]
  );
  return (
    <PrivyAuthContext.Provider value={value}>
      {children}
    </PrivyAuthContext.Provider>
  );
}
