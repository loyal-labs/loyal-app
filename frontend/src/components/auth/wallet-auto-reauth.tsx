"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  useAuthApiClient,
  useAuthSession,
} from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import {
  runWalletMessageProofFlow,
  runWalletSiwsProofFlow,
} from "@/lib/auth/wallet-proof-flow";
import { WalletProofSignerError } from "@/lib/auth/wallet-proof-signer";
import { AuthApiClientError } from "@/lib/auth/client";
import { createBrowserLifecycleTracker } from "@/features/observability/client";
import { normalizeLifecycleErrorCode } from "@/features/observability/lifecycle-contract";

type ReauthStatus =
  | "idle"
  | "awaiting_signature"
  | "verifying"
  | "done"
  | "dismissed"
  | "rejected";

export function WalletAutoReauth() {
  const { isHydrated, isAuthenticated, refreshSession } = useAuthSession();
  const authApiClient = useAuthApiClient();
  const { isOpen: isSignInModalOpen } = useSignInModal();
  const { connected, publicKey, signIn, signMessage, disconnect, wallet } =
    useWallet();
  const { turnstile } = usePublicEnv();

  // Silent re-auth has no captcha UI, so resolve a Turnstile token for the
  // gated challenge endpoint without one. Bypass (local) and misconfigured
  // envs resolve immediately; in widget mode there is no token to obtain
  // silently, so we defer to the interactive sign-in (which renders the widget).
  const silentTurnstileToken =
    turnstile.mode === "bypass"
      ? turnstile.verificationToken
      : turnstile.mode === "misconfigured"
      ? "captcha-skipped"
      : null;

  const attemptedAddressRef = useRef<string | null>(null);
  const failedRef = useRef(false);
  const [status, setStatus] = useState<ReauthStatus>("idle");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (connected && publicKey) {
      return;
    }

    attemptedAddressRef.current = null;
    failedRef.current = false;
    setStatus("idle");
  }, [connected, publicKey]);

  useEffect(() => {
    if (!isHydrated || isAuthenticated || isSignInModalOpen) {
      return;
    }

    if (!connected || !publicKey || ((!signIn || !wallet) && !signMessage)) {
      return;
    }

    if (!silentTurnstileToken) {
      return;
    }

    const walletAddress = publicKey.toBase58();

    if (attemptedAddressRef.current === walletAddress || failedRef.current) {
      return;
    }

    attemptedAddressRef.current = walletAddress;

    async function reauthenticate() {
      const lifecycle = createBrowserLifecycleTracker({
        flowName: "auth.sign_in",
        flowVariant: "auto_reauth",
      });
      lifecycle.start("intent");
      lifecycle.observe("wallet_select");
      try {
        if (signIn && wallet) {
          setStatus("awaiting_signature");
          await runWalletSiwsProofFlow({
            authApiClient,
            lifecycle,
            onStatusChange: setStatus,
            signIn,
            turnstileToken: silentTurnstileToken ?? undefined,
            walletName: wallet.adapter.name,
          });
        } else {
          lifecycle.observe("wallet_connect");
          await runWalletMessageProofFlow({
            authApiClient,
            lifecycle,
            messageSigner: signMessage,
            onStatusChange: setStatus,
            turnstileToken: silentTurnstileToken ?? undefined,
            walletAddress,
          });
        }
        lifecycle.observe("session_refresh");
        await refreshSession();
        setStatus("done");
        lifecycle.complete("ui_commit");
      } catch (error) {
        const isSignatureRejection =
          error instanceof WalletProofSignerError &&
          error.code === "wallet_signature_rejected";
        if (isSignatureRejection) {
          lifecycle.cancel("wallet_approval", { errorCode: "wallet_rejected" });
          failedRef.current = true;
          setStatus("idle");
          return;
        }

        // Reset so user can retry later if needed. Network/CORS/API errors
        // are silently ignored so they don't block wallet usage.
        attemptedAddressRef.current = null;
        setStatus("idle");
        lifecycle.fail("completion", {
          errorCode: normalizeLifecycleErrorCode(
            error instanceof AuthApiClientError ? error.code : undefined
          ),
        });
        console.warn("[wallet-auto-reauth] re-auth failed:", error);
      }
    }

    void reauthenticate();
  }, [
    authApiClient,
    connected,
    isAuthenticated,
    isHydrated,
    isSignInModalOpen,
    publicKey,
    refreshSession,
    signIn,
    signMessage,
    silentTurnstileToken,
    retryCount,
    wallet,
  ]);

  // Auto-dismiss "done" banner after delay
  useEffect(() => {
    if (status !== "done") {
      return;
    }

    const timer = setTimeout(() => setStatus("dismissed"), 1500);
    return () => clearTimeout(timer);
  }, [status]);

  const handleRetry = useCallback(() => {
    failedRef.current = false;
    attemptedAddressRef.current = null;
    setStatus("idle");
    setRetryCount((c) => c + 1);
  }, []);

  const handleDisconnect = useCallback(async () => {
    setStatus("idle");
    failedRef.current = false;
    attemptedAddressRef.current = null;
    await disconnect();
  }, [disconnect]);

  const showBanner =
    status === "awaiting_signature" ||
    status === "verifying" ||
    status === "done" ||
    status === "rejected";

  if (isSignInModalOpen || !showBanner) {
    return null;
  }

  const isSuccess = status === "done";
  const dotColor = isSuccess ? "#6bc77a" : "#dc8080";
  const pingColor = isSuccess
    ? "rgba(107, 199, 122, 0.5)"
    : "rgba(220, 120, 120, 0.5)";

  const buttonStyle = {
    color: "#8E8E93",
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: "14px",
    fontWeight: 400,
    lineHeight: "20px",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
    textDecorationColor: "rgba(60, 60, 67, 0.24)",
    textUnderlineOffset: "2px",
    whiteSpace: "nowrap" as const,
  };

  const statusText =
    status === "awaiting_signature"
      ? "Please approve sign-in in your wallet"
      : status === "verifying"
      ? "Verifying wallet\u2026"
      : status === "done"
      ? "All good"
      : "Signature rejected";

  return (
    <div
      style={{
        position: "fixed",
        top: "64px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 59,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        background: "rgba(255, 255, 255, 0.94)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(0, 0, 0, 0.08)",
        borderRadius: "60px",
        padding: "10px 20px",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.12)",
        animation: isSuccess
          ? "fadeOut 0.4s cubic-bezier(0.4, 0, 0.2, 1) 1.1s forwards"
          : "slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "12px",
          height: "12px",
        }}
      >
        {status !== "rejected" && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "9999px",
              background: pingColor,
              animation: isSuccess
                ? "none"
                : "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
            }}
          />
        )}
        <span
          style={{
            position: "relative",
            display: "inline-flex",
            width: "8px",
            height: "8px",
            borderRadius: "9999px",
            background: dotColor,
            transition: "background 0.3s ease",
          }}
        />
      </span>
      <span
        style={{
          color: "#1C1C1E",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "14px",
          fontWeight: 400,
          lineHeight: "20px",
          whiteSpace: "nowrap",
        }}
      >
        {statusText}
      </span>
      {status === "rejected" && (
        <>
          <span style={{ color: "rgba(60, 60, 67, 0.2)" }}>|</span>
          <button onClick={handleRetry} style={buttonStyle}>
            Retry
          </button>
          <button onClick={handleDisconnect} style={buttonStyle}>
            Sign out
          </button>
        </>
      )}
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes fadeOut {
          from { opacity: 1; transform: translateX(-50%) translateY(0); }
          to { opacity: 0; transform: translateX(-50%) translateY(-8px); }
        }
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
