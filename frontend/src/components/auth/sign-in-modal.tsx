"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthCapability } from "@/lib/auth/capability";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";

import { TurnstileWidget } from "./turnstile-widget";
import { WalletTab } from "./wallet-tab";

function ConnectedView() {
  const { publicKey, disconnect } = useWallet();
  const { logout, user } = useAuthSession();
  const { close } = useSignInModal();
  const { hasAuthSession, hasWalletConnection } = useAuthCapability();
  const [copied, setCopied] = useState(false);
  const address = publicKey?.toBase58() ?? user?.displayAddress ?? "";

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <span className="text-green-600 text-xl">✓</span>
      </div>
      <p className="font-medium text-sm">
        {hasWalletConnection ? "Connected" : "Signed in"}
      </p>
      {address ? (
        <button
          className="group max-w-full cursor-pointer break-all px-4 text-center font-mono text-neutral-500 text-xs transition hover:text-neutral-700"
          onClick={handleCopy}
          title="Copy address"
          type="button"
        >
          {address}
          <span className="ml-1 inline-block text-neutral-400 group-hover:text-neutral-600">
            {copied ? "✓" : "⧉"}
          </span>
        </button>
      ) : null}
      {hasAuthSession ? (
        <button
          className="mt-1 text-neutral-400 text-xs underline transition hover:text-neutral-700"
          onClick={async () => {
            await logout();
            close();
          }}
          type="button"
        >
          Sign out
        </button>
      ) : null}
      {hasWalletConnection ? (
        <button
          className="text-neutral-400 text-xs underline transition hover:text-neutral-700"
          onClick={async () => {
            await disconnect();
            close();
          }}
          type="button"
        >
          Disconnect wallet
        </button>
      ) : null}
    </div>
  );
}

export function SignInModal() {
  const { isOpen, close } = useSignInModal();
  const { capability } = useAuthCapability();
  const publicEnv = usePublicEnv();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileMode = publicEnv.turnstile.mode;
  const turnstileVerificationToken =
    turnstileMode === "bypass"
      ? publicEnv.turnstile.verificationToken
      : null;

  // Auto-resolve captcha for bypass (local dev) and misconfigured environments
  const needsCaptchaWidget = turnstileMode === "widget";
  useEffect(() => {
    if (!needsCaptchaWidget && captchaToken === null) {
      setCaptchaToken(
        turnstileMode === "bypass"
          ? turnstileVerificationToken
          : "captcha-skipped"
      );
    }
  }, [
    captchaToken,
    needsCaptchaWidget,
    turnstileMode,
    turnstileVerificationToken,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close();
        setCaptchaToken(null);
      }
    },
    [close]
  );

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogContent className="border-neutral-200 bg-white text-neutral-900 sm:max-w-[520px] [&_[data-slot=dialog-close]]:text-neutral-500">
        {capability !== "anonymous" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-neutral-900">Account</DialogTitle>
              <DialogDescription className="sr-only">
                Signed in
              </DialogDescription>
            </DialogHeader>
            <ConnectedView />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-neutral-900">Sign In</DialogTitle>
              <DialogDescription className="text-neutral-500">
                Choose your preferred sign-in method.
              </DialogDescription>
            </DialogHeader>
            {captchaToken === null ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <p className="text-neutral-500 text-sm">
                  Complete verification to continue
                </p>
                <TurnstileWidget onVerify={setCaptchaToken} />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <WalletTab />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
