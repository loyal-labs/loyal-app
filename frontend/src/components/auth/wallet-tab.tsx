"use client";

import { AlertCircle, ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";
import { MatrixLoader } from "@/components/wallet-workspace/facelift/matrix-loader";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";
import { useWalletProofAuth } from "./use-wallet-proof-auth";

const MOBILE_WALLETS = [
  {
    name: "Phantom",
    icon: "https://phantom.app/favicon.ico",
    browseUrl: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(
        url
      )}?ref=${encodeURIComponent(url)}`,
  },
  {
    name: "Solflare",
    icon: "https://solflare.com/favicon.ico",
    browseUrl: (url: string) =>
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(
        url
      )}?ref=${encodeURIComponent(url)}`,
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
      <p className="text-muted-foreground text-sm">
        Open this page in your wallet&apos;s built-in browser:
      </p>
      {MOBILE_WALLETS.map((wallet) => (
        <TrackedExternalLink
          className="flex h-14 items-center gap-3 rounded-2xl bg-secondary px-4 text-foreground text-sm transition hover:bg-accent-selected"
          href={wallet.browseUrl(currentUrl)}
          key={wallet.name}
          linkText={`Open in ${wallet.name}`}
          source="wallet_mobile_browser_link"
        >
          <img alt={wallet.name} className="h-6 w-6" src={wallet.icon} />
          <span className="min-w-0 flex-1">Open in {wallet.name}</span>
          <ArrowUpRight className="h-4 w-4 text-tertiary" />
        </TrackedExternalLink>
      ))}
    </div>
  );
}

function LedgerModeToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  // transitions-dev "checkbox check": the box fills, then the checkmark draws
  // via stroke-dashoffset. The recipe wants aria-checked on the .t-check
  // button itself, so the row is a plain div that forwards clicks (the
  // button's own clicks — mouse or Space/Enter — bubble up to it too).
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl bg-secondary px-4 py-3 text-left text-foreground text-sm ${
        disabled ? "opacity-60" : "cursor-pointer"
      }`}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
    >
      <button
        aria-checked={checked}
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        className="t-check mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-card shadow-[inset_0_0_0_1.5px_var(--border)] aria-checked:bg-foreground aria-checked:shadow-[inset_0_0_0_1.5px_var(--foreground)]"
        disabled={disabled}
        role="checkbox"
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-2.5 w-2.5"
          fill="none"
          viewBox="0 0 10.1668 10.1668"
        >
          <path
            d="M1 5.52L3.92 9.17L9.17 1"
            stroke="#ffffff"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
          />
        </svg>
      </button>
      <span className="min-w-0">
        <span className="block font-medium" id={labelId}>
          I use Ledger or hardware wallet
        </span>
        <span
          className="mt-0.5 block text-muted-foreground text-xs"
          id={descriptionId}
        >
          Approves a login verification transaction. Loyal will not broadcast
          it.
        </span>
      </span>
    </div>
  );
}

export function WalletTab({
  captchaToken,
  onCaptchaConsumed,
  onFlowStart,
}: {
  captchaToken?: string | null;
  onCaptchaConsumed?: () => void;
  onFlowStart?: () => void;
}) {
  const cherryRuntime = useCherryRuntime();
  const isCherryEmbedded = cherryRuntime.mode === "cherry_embedded";
  const [useLedgerProof, setUseLedgerProof] = useState(false);
  const [showWalletSelection, setShowWalletSelection] = useState(false);
  const {
    connected,
    publicKey,
    installedWallets,
    state,
    connectWallet,
    retry,
    startConnectedWalletVerification,
  } = useWalletProofAuth({
    captchaToken: captchaToken ?? undefined,
    onCaptchaConsumed,
    onFlowStart,
    useLedgerProof,
  });

  const isVerified = Boolean(captchaToken);

  const isMobile = useIsMobile();

  const handleChooseAnotherWallet = useCallback(() => {
    retry();
    setShowWalletSelection(true);
  }, [retry]);

  const handleConnectWallet = useCallback(
    (walletName: Parameters<typeof connectWallet>[0]) => {
      setShowWalletSelection(false);
      connectWallet(walletName);
    },
    [connectWallet]
  );

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
    const statusMessage =
      state.status === "connecting"
        ? "Connecting your wallet..."
        : state.status === "awaiting_signature"
        ? useLedgerProof
          ? "Approve the Ledger verification transaction..."
          : "Approve sign-in in your wallet..."
        : "Verifying your wallet and preparing your smart account...";

    return (
      <div className="flex flex-col items-center gap-4 rounded-[28px] bg-secondary px-5 py-8 text-center">
        <MatrixLoader />
        <p className="max-w-[320px] text-muted-foreground text-sm">
          <TextSwap text={statusMessage} />
        </p>
        {isCherryEmbedded ? null : (
          <button
            className="rounded-full px-4 py-2 font-medium text-muted-foreground text-sm transition hover:bg-accent-selected hover:text-foreground"
            onClick={handleChooseAnotherWallet}
            type="button"
          >
            Choose another wallet
          </button>
        )}
      </div>
    );
  }

  if (isErrorState && showError) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-[24px] bg-destructive/10 p-4 text-destructive text-sm">
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card">
              <AlertCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium">{state.errorMessage}</p>
              {state.errorDetails.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-destructive/80">
                  {state.errorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        {/* Hardware wallets refuse message signing without any prompt, which
            lands here as an opaque wallet error. Keep the Ledger escape hatch
            visible so those users can self-serve — but not after a deliberate
            cancellation, which is not a capability problem. */}
        {state.status !== "rejected" && !isCherryEmbedded && (
          <LedgerModeToggle
            checked={useLedgerProof}
            disabled={!isVerified}
            onChange={setUseLedgerProof}
          />
        )}
        <button
          className="h-12 rounded-full bg-foreground px-4 font-medium text-background text-sm transition hover:bg-foreground/90"
          onClick={
            isCherryEmbedded
              ? () => {
                  retry();
                  setShowWalletSelection(false);
                }
              : handleChooseAnotherWallet
          }
          type="button"
        >
          {isCherryEmbedded ? "Retry verification" : "Choose another wallet"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {connected && publicKey && !showWalletSelection ? (
        <div className="flex flex-col gap-2">
          {isCherryEmbedded ? null : (
            <LedgerModeToggle
              checked={useLedgerProof}
              disabled={!isVerified}
              onChange={setUseLedgerProof}
            />
          )}
          <button
            className="h-12 rounded-full bg-foreground px-4 font-medium text-background text-sm transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!isVerified}
            onClick={startConnectedWalletVerification}
            type="button"
          >
            <TextSwap
              text={
                isCherryEmbedded
                  ? "Verify Cherry Wallet"
                  : useLedgerProof
                  ? "Verify Ledger Wallet"
                  : "Verify Connected Wallet"
              }
            />
          </button>
          {isCherryEmbedded ? null : (
            <button
              className="h-12 rounded-full px-4 font-medium text-muted-foreground text-sm transition hover:bg-accent-selected hover:text-foreground"
              onClick={handleChooseAnotherWallet}
              type="button"
            >
              Choose another wallet
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <LedgerModeToggle
            checked={useLedgerProof}
            disabled={!isVerified}
            onChange={setUseLedgerProof}
          />
          {installedWallets.map((installedWallet) => (
            <button
              className="flex h-14 items-center gap-3 rounded-2xl bg-secondary px-4 text-foreground text-sm transition hover:bg-accent-selected disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!isVerified}
              key={installedWallet.adapter.name}
              onClick={() => handleConnectWallet(installedWallet.adapter.name)}
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
              <ArrowUpRight className="h-4 w-4 text-tertiary" />
            </button>
          ))}
          {installedWallets.length === 0 && isMobile && <MobileWalletList />}
          {installedWallets.length === 0 && !isMobile && (
            <p className="py-4 text-center text-muted-foreground text-sm">
              No wallet extensions detected. Install a Solana wallet extension
              to continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
