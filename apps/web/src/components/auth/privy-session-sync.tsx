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

import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";
import {
  createBrowserLifecycleTracker,
  lifecycleFlowHeaders,
} from "@/features/observability/client";
import {
  lifecycleErrorMessage,
  type LifecycleFlowStage,
  type LifecycleTracker,
  normalizeLifecycleErrorCode,
} from "@/features/observability/lifecycle-contract";

import { useNeedsMobileWalletBrowser } from "./mobile-wallet-list";
import { useSignerRestoration } from "./use-signer-restoration";

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
      ...(flowId ? lifecycleFlowHeaders(flowId) : {}),
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
  const { close: closeSignInModal, registerHandler } = useSignInModal();

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
  const [signerLifecycle, setSignerLifecycle] =
    useState<LifecycleTracker | null>(null);
  const finishSignerRestoration = useCallback(
    () => setSignerLifecycle(null),
    []
  );
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
  const lifecycleRef = useRef<LifecycleTracker | null>(null);
  const lifecycleStageRef =
    useRef<LifecycleFlowStage<"auth.sign_in">>("wallet_approval");
  const lifecycleDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const clearLifecycleDeadline = useCallback(() => {
    if (lifecycleDeadlineRef.current !== null)
      clearTimeout(lifecycleDeadlineRef.current);
    lifecycleDeadlineRef.current = null;
  }, []);
  useEffect(() => clearLifecycleDeadline, [clearLifecycleDeadline]);
  const startLifecycle = useCallback(() => {
    if (lifecycleRef.current) return lifecycleRef.current;
    const lifecycle = createBrowserLifecycleTracker({
      flowName: "auth.sign_in",
      flowVariant: "interactive",
    });
    lifecycleRef.current = lifecycle;
    lifecycleStageRef.current = "wallet_approval";
    lifecycle.start("intent");
    // A deadline marks a stall, not a failed authentication or user abandonment.
    lifecycleDeadlineRef.current = setTimeout(
      () =>
        lifecycle.timeout(lifecycleStageRef.current, {
          errorCode: "request_failed",
          errorDetail: "request_timeout",
        }),
      120_000
    );
    return lifecycle;
  }, []);

  const { login } = useLogin({
    onComplete: ({ loginAccount }) => {
      loginAddressRef.current =
        loginAccount && loginAccount.type === "wallet"
          ? loginAccount.address
          : null;
    },
    onError: (code) => {
      clearLifecycleDeadline();
      const cancelled =
        code === "exited_auth_flow" || code === "oauth_user_denied";
      if (cancelled) {
        lifecycleRef.current?.cancel("wallet_approval");
      } else {
        lifecycleRef.current?.fail("wallet_approval", {
          errorCode: "request_failed",
          errorMessage: `Privy login: ${code}`,
        });
      }
      lifecycleRef.current = null;
      setWantsSession(false);
      setStep("idle");
      loginAddressRef.current = null;
      setError(
        cancelled ? null : "Sign-in could not be completed. Please try again."
      );
    },
  });

  const start = useCallback(() => {
    if (runningRef.current || signerLifecycle) return;
    closeSignInModal();
    startLifecycle();
    setError(null);
    setWantsSession(true);
    if (!authenticated) {
      setStep("privy");
      login();
      return;
    }
    setStep("exchanging");
  }, [
    authenticated,
    closeSignInModal,
    login,
    setWantsSession,
    signerLifecycle,
    startLifecycle,
  ]);

  const addEmail = useCallback(() => {
    if (authenticated) {
      linkEmail();
      return;
    }
    closeSignInModal();
    setError(null);
    setWantsSession(true);
    setStep("privy");
    login({ loginMethods: ["wallet"], walletChainType: "solana-only" });
  }, [authenticated, closeSignInModal, linkEmail, login, setWantsSession]);

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
        lifecycleStageRef.current = "wallet_connect";
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
      lifecycleStageRef.current = "completion";
      lifecycle.observe("completion");
      await exchangePrivySession(address, lifecycle.flowId);

      // The exchange sets the session cookie, so commit the UI before touching
      // the wallet adapter: a connect that hangs or rejects used to leave the
      // user signed in on the server and signed out in the browser, with the
      // sign-in button dead until a reload.
      lifecycle.observe("session_refresh");
      lifecycleStageRef.current = "session_refresh";
      const restoredSession = await refreshSession();
      if (restoredSession?.user?.walletAddress !== address) {
        lifecycle.fail("session_refresh", {
          errorCode: restoredSession?.user
            ? "wallet_account_mismatch"
            : "unauthenticated",
        });
        throw new Error(
          "The sign-in session could not be restored. Please sign in again."
        );
      }
      lifecycle.observe("backend_session_valid");
      closeSignInModal();

      // Share the render-aware signer path with returning sessions.
      setSignerLifecycle(lifecycle);
      if (!hasEmail) linkEmail();
    },
    [
      closeSignInModal,
      createWallet,
      linkEmail,
      logout,
      privyUser,
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
    const lifecycle = startLifecycle();
    lifecycle.observe("privy_authenticated");
    void completeSignIn(lifecycle)
      .catch((e: unknown) => {
        lifecycle.fail(lifecycleStageRef.current, {
          errorCode: normalizeLifecycleErrorCode(
            e && typeof e === "object" && "code" in e
              ? (e as { code?: unknown }).code
              : undefined
          ),
          errorMessage: lifecycleErrorMessage(e),
        });
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        clearLifecycleDeadline();
        runningRef.current = false;
        lifecycleRef.current = null;
        setWantsSession(false);
        setStep("idle");
      });
  }, [
    authenticated,
    clearLifecycleDeadline,
    completeSignIn,
    privyUser,
    setWantsSession,
    startLifecycle,
    walletsReady,
    wantsSession,
  ]);

  useSignerRestoration({
    address: user?.walletAddress ?? null,
    enabled: isHydrated && isAuthenticated && walletsReady && !wantsSession,
    adapter,
    wallets: privyWallets,
    lifecycle: signerLifecycle,
    onSettled: finishSignerRestoration,
  });

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
      {error && step === "idle" ? (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl border bg-background p-4 text-foreground shadow-sm">
          <p className="text-sm leading-relaxed" role="alert">
            {error}
          </p>
          <div className="mt-4 flex gap-3">
            <Button onClick={start} type="button">
              Try signing in again
            </Button>
            <Button
              onClick={() => setError(null)}
              type="button"
              variant="outline"
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </PrivyAuthContext.Provider>
  );
}
