"use client";

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
          className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-neutral-900 text-sm transition hover:bg-neutral-50"
          href={wallet.browseUrl(currentUrl)}
          key={wallet.name}
          linkText={`Open in ${wallet.name}`}
          source="wallet_mobile_browser_link"
        >
          <img alt={wallet.name} className="h-6 w-6" src={wallet.icon} />
          <span>Open in {wallet.name}</span>
        </TrackedExternalLink>
      ))}
    </div>
  );
}

export function WalletTab({ onFlowStart }: { onFlowStart?: () => void }) {
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
  });

  const isMobile = useIsMobile();

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
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="text-neutral-500 text-sm">
          {state.status === "connecting"
            ? "Connecting your wallet..."
            : state.status === "awaiting_signature"
              ? "Approve the message signature in your wallet..."
              : "Verifying wallet ownership..."}
        </p>
      </div>
    );
  }

  if (isErrorState && showError) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
          <p>{state.errorMessage}</p>
          {state.errorDetails.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {state.errorDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          className="rounded-lg bg-neutral-900 px-4 py-2.5 font-medium text-sm text-white transition hover:bg-neutral-800"
          onClick={retry}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      {connected && publicKey ? (
        <button
          className="rounded-lg bg-neutral-900 px-4 py-2.5 font-medium text-sm text-white transition hover:bg-neutral-800"
          onClick={startConnectedWalletVerification}
          type="button"
        >
          Verify Connected Wallet
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {installedWallets.map((installedWallet) => (
            <button
              className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-neutral-900 text-sm transition hover:bg-neutral-50"
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
              <span>{installedWallet.adapter.name}</span>
            </button>
          ))}
          {installedWallets.length === 0 && isMobile && <MobileWalletList />}
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
