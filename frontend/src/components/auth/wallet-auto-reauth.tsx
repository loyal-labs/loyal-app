"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthApiClient, useAuthSession } from "@/contexts/auth-session-context";
import { WalletProofSignerError, signWalletProofMessage } from "@/lib/auth/wallet-proof-signer";

type ReauthStatus = "idle" | "awaiting_signature" | "verifying" | "done" | "dismissed" | "rejected";

export function WalletAutoReauth() {
  const { isHydrated, isAuthenticated, refreshSession } = useAuthSession();
  const authApiClient = useAuthApiClient();
  const { connected, publicKey, signMessage, disconnect } = useWallet();

  const attemptedAddressRef = useRef<string | null>(null);
  const failedRef = useRef(false);
  const [status, setStatus] = useState<ReauthStatus>("idle");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isHydrated || isAuthenticated) {
      return;
    }

    if (!connected || !publicKey || !signMessage) {
      return;
    }

    const walletAddress = publicKey.toBase58();

    if (attemptedAddressRef.current === walletAddress || failedRef.current) {
      return;
    }

    attemptedAddressRef.current = walletAddress;

    async function reauthenticate() {
      try {
        const challenge = await authApiClient.challengeWalletAuth({
          walletAddress,
        });

        setStatus("awaiting_signature");
        const signature = await signWalletProofMessage({
          signMessage,
          message: challenge.message,
        });

        setStatus("verifying");
        await authApiClient.completeWalletAuth({
          challengeToken: challenge.challengeToken,
          signature,
        });

        await refreshSession();
        setStatus("done");
        console.log("[wallet-auto-reauth] session restored for", walletAddress);
      } catch (error) {
        // Only show "rejected" banner for actual signature rejections.
        // Network/CORS/API errors (e.g. auth server unreachable from this domain)
        // are silently ignored so they don't block wallet usage.
        const isSignatureRejection =
          error instanceof WalletProofSignerError &&
          error.code === "wallet_signature_rejected";
        if (isSignatureRejection) {
          failedRef.current = true;
          setStatus("rejected");
        } else {
          // Reset so user can retry later if needed
          attemptedAddressRef.current = null;
          setStatus("idle");
        }
        console.warn("[wallet-auto-reauth] re-auth failed:", error);
      }
    }

    void reauthenticate();
  }, [authApiClient, connected, isAuthenticated, isHydrated, publicKey, refreshSession, signMessage, retryCount]);

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

  if (!showBanner) {
    return null;
  }

  const isSuccess = status === "done";
  const dotColor = isSuccess ? "#6bc77a" : "#dc8080";
  const pingColor = isSuccess
    ? "rgba(107, 199, 122, 0.5)"
    : "rgba(220, 120, 120, 0.5)";

  const buttonStyle = {
    color: "rgba(255, 255, 255, 0.7)",
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: "14px",
    fontWeight: 400,
    lineHeight: "20px",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
    textDecorationColor: "rgba(255, 255, 255, 0.3)",
    textUnderlineOffset: "2px",
    whiteSpace: "nowrap" as const,
  };

  const statusText =
    status === "awaiting_signature"
      ? "Please approve the signature request in your wallet"
      : status === "verifying"
        ? "Verifying signature\u2026"
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
        background: "rgba(30, 30, 30, 0.85)",
        backdropFilter: "blur(48px)",
        WebkitBackdropFilter: "blur(48px)",
        borderRadius: "60px",
        padding: "10px 20px",
        boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.08)",
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
          color: "rgba(255, 255, 255, 0.9)",
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
          <span style={{ color: "rgba(255, 255, 255, 0.3)" }}>|</span>
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
