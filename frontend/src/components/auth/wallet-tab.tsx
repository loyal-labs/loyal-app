"use client";

import { AlertCircle, ArrowUpRight, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";
import { useWalletProofAuth } from "./use-wallet-proof-auth";

const MOBILE_WALLETS = [
  {
    name: "Phantom",
    icon: "https://phantom.app/favicon.ico",
    browseUrl: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(url)}`,
  },
  {
    name: "Solflare",
    icon: "https://solflare.com/favicon.ico",
    browseUrl: (url: string) =>
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(url)}`,
  },
] as const;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);
  return isMobile;
}

function MobileWalletList() {
  const currentUrl = useMemo(
    () => (typeof window !== "undefined" ? window.location.href : ""),
    []
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-neutral-500 text-sm">
        Open this page in your wallet&apos;s built-in browser:
      </p>
      {MOBILE_WALLETS.map((wallet) => (
        <TrackedExternalLink
          className="flex h-14 items-center gap-3 rounded-2xl bg-[#f5f5f5] px-4 text-neutral-900 text-sm transition hover:bg-black/[0.06]"
          href={wallet.browseUrl(currentUrl)}
          key={wallet.name}
          linkText={`Open in ${wallet.name}`}
          source="wallet_mobile_browser_link"
        >
          <img alt={wallet.name} className="h-6 w-6" src={wallet.icon} />
          <span className="min-w-0 flex-1">Open in {wallet.name}</span>
          <ArrowUpRight className="h-4 w-4 text-neutral-400" />
        </TrackedExternalLink>
      ))}
    </div>
  );
}

export function WalletTab({
  onFlowStart,
  onTurnstileConsumed,
  turnstileToken,
}: {
  onFlowStart?: () => void;
  onTurnstileConsumed?: () => void;
  turnstileToken?: string | null;
}) {
  const {
    connected,
    publicKey,
    installedWallets,
    state,
    connectWallet,
    retry,
    startConnectedWalletVerification,
  } = useWalletProofAuth({
    onFlowStart,
    onTurnstileConsumed,
    turnstileToken: turnstileToken ?? undefined,
  });

  const isVerified = Boolean(turnstileToken);

  const isMobile = useIsMobile();

  useEffect(() => {
    if (
      connected &&
      publicKey &&
      isVerified &&
      state.status === "idle"
    ) {
      startConnectedWalletVerification();
    }
  }, [
    connected,
    isVerified,
    publicKey,
    startConnectedWalletVerification,
    state.status,
  ]);

  // Delay showing errors so transient failures during connection don't flash
  const isErrorState =
    state.status === "rejected" ||
    state.status === "unsupported" ||
    state.status === "error";
  const [showError, setShowError] = useState(false);
  useEffect(() => {
    if (!isErrorState) {
      setShowError(false);
      return;
    }
    const t = setTimeout(() => setShowError(true), 600);
    return () => clearTimeout(t);
  }, [isErrorState]);

  if (
    state.status === "connecting" ||
    state.status === "awaiting_signature" ||
    state.status === "verifying"
  ) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-[28px] bg-[#f5f5f5] px-5 py-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white">
          <LoaderCircle className="h-6 w-6 animate-spin text-neutral-950" />
        </span>
        <p className="max-w-[320px] text-neutral-500 text-sm">
          {state.status === "connecting"
            ? "Connecting your wallet..."
            : state.status === "awaiting_signature"
              ? "Approve the message signature in your wallet..."
              : "Verifying your wallet and preparing your smart account..."}
        </p>
      </div>
    );
  }

  if (isErrorState && showError) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-[24px] bg-[#fff1f2] p-4 text-[#d50012] text-sm">
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white">
              <AlertCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium">{state.errorMessage}</p>
              {state.errorDetails.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-[#d50012]/80">
                  {state.errorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <button
          className="h-12 rounded-full bg-neutral-950 px-4 font-medium text-sm text-white transition hover:bg-neutral-800"
          onClick={retry}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {connected && publicKey ? (
        <button
          className="h-12 rounded-full bg-neutral-950 px-4 font-medium text-sm text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!isVerified}
          onClick={startConnectedWalletVerification}
          type="button"
        >
          Verify Connected Wallet
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {installedWallets.map((installedWallet) => (
            <button
              className="flex h-14 items-center gap-3 rounded-2xl bg-[#f5f5f5] px-4 text-neutral-900 text-sm transition hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!isVerified}
              key={installedWallet.adapter.name}
              onClick={() => connectWallet(installedWallet.adapter.name)}
              type="button"
            >
              {installedWallet.adapter.icon && (
                <img
                  alt={installedWallet.adapter.name}
                  className="h-6 w-6"
                  src={installedWallet.adapter.icon}
                />
              )}
              <span className="min-w-0 flex-1 text-left">
                {installedWallet.adapter.name}
              </span>
              <ArrowUpRight className="h-4 w-4 text-neutral-400" />
            </button>
          ))}
          {installedWallets.length === 0 && isMobile && (
            <MobileWalletList />
          )}
          {installedWallets.length === 0 && !isMobile && (
            <p className="py-4 text-center text-neutral-500 text-sm">
              No wallet extensions detected. Install a Solana wallet extension
              to continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
