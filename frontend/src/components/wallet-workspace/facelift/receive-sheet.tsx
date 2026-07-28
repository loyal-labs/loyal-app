"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";

const ASSET_BASE = "/wallet-workspace/facelift";

// Facelift take on the OG Receive view (receive-content.tsx): Solana-only
// warning, QR card with the mascot in the center and the raw address, and a
// Copy Address pill. Opens as a centered sheet from the sidebar's QR button.
export function ReceiveSheet({
  isOpen,
  onClose,
  walletAddress,
}: {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string | null;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopy = () => {
    if (!walletAddress) {
      return;
    }
    void copyTextToClipboard(walletAddress).then((didCopy) => {
      if (didCopy) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    });
  };

  return (
    <SheetReveal
      isOpen={isOpen}
      onClose={onClose}
      scrimClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:items-end max-[795px]:bg-white/60 max-[795px]:p-0"
      sheetClassName="flex w-[400px] min-w-0 flex-col overflow-clip rounded-3xl bg-white max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
    >
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
          Receive
        </h2>
        <button
          aria-label="Close receive"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
          onClick={onClose}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-cross.svg`}
          />
        </button>
      </header>
      <div className="flex w-full flex-col items-center gap-6 px-6 pt-2 pb-2">
        <p className="max-w-[300px] text-center text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          Use to receive tokens on the Solana network only. Other assets will
          be lost forever.
        </p>
        <div className="flex w-full max-w-[280px] flex-col items-center gap-4 rounded-[20px] border border-black/[0.08] p-8">
          {walletAddress ? (
            <div className="relative">
              <QRCodeSVG
                bgColor="transparent"
                fgColor="#000"
                level="M"
                size={192}
                value={walletAddress}
              />
              <span className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex h-8 w-10 items-center justify-center rounded bg-white p-0.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-7 w-9"
                  src={`${ASSET_BASE}/tab-mascot.svg`}
                />
              </span>
            </div>
          ) : (
            <div className="size-48 rounded-lg bg-black/[0.04]" />
          )}
          <p className="break-all text-center text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
            {walletAddress ?? "No wallet connected"}
          </p>
        </div>
      </div>
      <div className="w-full px-5 pt-2 pb-4">
        <button
          className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5 enabled:hover:-translate-y-0.5 enabled:hover:bg-[#171717] enabled:active:translate-y-0 disabled:opacity-40"
          disabled={!walletAddress}
          onClick={handleCopy}
          type="button"
        >
          <TextSwap text={copied ? "Copied!" : "Copy Address"} />
        </button>
      </div>
    </SheetReveal>
  );
}
