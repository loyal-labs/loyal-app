"use client";

import { useLoginWithSiws, usePrivy } from "@privy-io/react-auth";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
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

import { exchangePrivySession } from "@/components/auth/privy-session-sync";
import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";

import { useCherryRuntime } from "./runtime-context";
import { isVerifiedCherryWalletMatch } from "./runtime-contract";

type Status = "idle" | "signing" | "exchanging" | "error";

type CherryPrivyAuthState = {
  status: Status;
  error: string | null;
  start: () => void;
};

const CherryPrivyAuthContext = createContext<CherryPrivyAuthState | null>(null);

export function useCherryPrivyAuth(): CherryPrivyAuthState | null {
  return useContext(CherryPrivyAuthContext);
}

/**
 * Headless Privy sign-in for the Cherry embed: no Privy modal, no captcha.
 * The verified Cherry wallet signs Privy's SIWS message, then the identity
 * token is exchanged for the Loyal session through the same route the web
 * app uses. Auto-starts once when signed out; Retry re-arms it.
 */
export function CherryPrivyAuthController({
  children,
}: {
  children: ReactNode;
}) {
  const runtime = useCherryRuntime();
  const { ready, authenticated, user: privyUser, logout } = usePrivy();
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws();
  const { connected, publicKey, signMessage } = useWallet();
  const { isHydrated, isAuthenticated, refreshSession } = useAuthSession();
  const { openAccount, close } = useSignInModal();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(false);
  const runningRef = useRef(false);

  const verifiedAddress =
    runtime.mode === "cherry_embedded" ? runtime.verifiedWalletAddress : null;
  const walletReady =
    connected &&
    verifiedAddress !== null &&
    isVerifiedCherryWalletMatch(verifiedAddress, publicKey?.toBase58() ?? null);

  const run = useCallback(async () => {
    if (!verifiedAddress || !signMessage) {
      throw new Error("Cherry wallet is not ready.");
    }
    const linked =
      authenticated &&
      privyUser?.linkedAccounts.some(
        (a) =>
          a.type === "wallet" &&
          a.chainType === "solana" &&
          "address" in a &&
          a.address === verifiedAddress
      );
    if (authenticated && !linked) {
      // Another Privy account is open in this WebView; never reuse it.
      await logout();
    }
    if (!linked) {
      setStatus("signing");
      const message = await generateSiwsMessage({ address: verifiedAddress });
      const signature = await signMessage(new TextEncoder().encode(message));
      await loginWithSiws({
        message,
        signature: bs58.encode(signature),
        walletClientType: "cherry",
        connectorType: "injected",
      });
    }
    setStatus("exchanging");
    await exchangePrivySession(verifiedAddress);
    await refreshSession();
  }, [
    authenticated,
    generateSiwsMessage,
    loginWithSiws,
    logout,
    privyUser,
    refreshSession,
    signMessage,
    verifiedAddress,
  ]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    attemptedRef.current = true;
    setError(null);
    openAccount();
    void run()
      .then(() => {
        setStatus("idle");
        close();
      })
      .catch((e: unknown) => {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        runningRef.current = false;
      });
  }, [close, openAccount, run]);

  useEffect(() => {
    if (isAuthenticated) {
      attemptedRef.current = false;
      return;
    }
    if (!ready || !isHydrated || !walletReady || attemptedRef.current) return;
    start();
  }, [isAuthenticated, isHydrated, ready, start, walletReady]);

  const value = useMemo(
    () => ({ status, error, start }),
    [status, error, start]
  );
  return (
    <CherryPrivyAuthContext.Provider value={value}>
      {children}
    </CherryPrivyAuthContext.Provider>
  );
}

/** Sign-in modal body in Cherry mode when Privy is on. */
export function CherryPrivySignIn() {
  const auth = useCherryPrivyAuth();
  if (!auth) return null;
  if (auth.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-destructive text-sm">{auth.error}</p>
        <button
          className="h-12 rounded-full bg-foreground px-4 font-medium text-background text-sm transition hover:bg-foreground/90"
          onClick={auth.start}
          type="button"
        >
          Retry verification
        </button>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground text-sm">
      {auth.status === "exchanging"
        ? "Signing in…"
        : "Approve sign-in in your Cherry wallet…"}
    </p>
  );
}
