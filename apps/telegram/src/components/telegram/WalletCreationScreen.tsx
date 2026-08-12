"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { DEBUG_FORCE_ONBOARDING } from "@/app/telegram/TelegramLayoutClient";
import {
  CloudStorageUnavailableError,
  ensureWalletKeypair,
} from "@/lib/solana/wallet/wallet-keypair-logic";

const Lottie = dynamic(() => import("lottie-react").then((m) => m.default), {
  ssr: false,
});

import shieldAnimation from "../../../public/onboarding/spinner.json";

export default function WalletCreationScreen({
  headerHeight,
  onWalletReady,
}: {
  headerHeight: number;
  onWalletReady: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const createWallet = useCallback(async () => {
    setError(null);
    try {
      const minDelay = DEBUG_FORCE_ONBOARDING
        ? new Promise((r) => setTimeout(r, 4000))
        : null;
      const [keypairResult] = await Promise.all([
        ensureWalletKeypair(),
        minDelay,
      ]);
      void keypairResult;
      onWalletReady();
    } catch (err) {
      console.error("Wallet creation failed during onboarding", err);
      if (err instanceof CloudStorageUnavailableError) {
        setError("Couldn't access wallet storage. Please try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    }
  }, [onWalletReady]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void createWallet();
  }, [createWallet]);

  const handleRetry = () => {
    initRef.current = false;
    void createWallet();
  };

  return (
    <div
      className="font-sans fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center justify-center bg-white"
      style={{ top: headerHeight }}
    >
      <div className="flex flex-col items-center gap-8 px-8">
        {/* Lottie animation */}
        <div className="flex size-[200px] items-center justify-center">
          <Lottie animationData={shieldAnimation} loop className="size-full" />
        </div>

        {/* Text */}
        <div className="flex flex-col items-center gap-1 text-center">
          <h2 className="font-semibold text-[22px] leading-[28px] text-black">
            {error ? "Wallet creation failed" : "Creating your wallet\u2026"}
          </h2>
          <p
            className="text-[17px] leading-[22px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {error ?? "This may take a few seconds"}
          </p>
        </div>

        {/* Retry button on error */}
        {error && (
          <button
            onClick={handleRetry}
            className="flex h-[50px] w-full max-w-[329px] items-center justify-center rounded-full bg-black active:opacity-80"
          >
            <span className="text-[17px] leading-[22px] text-white">
              Try Again
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
