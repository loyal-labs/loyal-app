"use client";

import { QRCodeSVG } from "qrcode.react";
import { type ReactNode, useEffect, useState } from "react";

import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import { SlidingTabs } from "@/components/wallet-workspace/facelift/sliding-tabs";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useEvmDepositAddress } from "@/components/wallet-workspace/facelift/use-evm-deposit-address";

const ASSET_BASE = "/wallet-workspace/facelift";
const TABS = ["Solana", "Other chains"] as const;
type Tab = (typeof TABS)[number];
const EVM_CHAIN_FALLBACK = ["ethereum", "base", "arbitrum", "polygon", "bsc"];
const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  bsc: "BNB Chain",
};

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
  const [tab, setTab] = useState<Tab>("Solana");
  const evm = useEvmDepositAddress(walletAddress);
  // Privy provisions the 0x address on first request; only ask once the
  // user actually opens the tab.
  useEffect(() => {
    if (isOpen && tab === "Other chains") void evm.load();
  }, [evm, isOpen, tab]);
  const isEvmTab = tab === "Other chains";
  const shownAddress = isEvmTab ? evm.info?.address ?? null : walletAddress;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopy = () => {
    if (!shownAddress) {
      return;
    }
    void copyTextToClipboard(shownAddress).then((didCopy) => {
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
      sheetClassName="flex w-[400px] min-w-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
    >
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
          Receive
        </h2>
        <button
          aria-label="Close receive"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent"
          onClick={onClose}
          type="button"
        >
          <ThemedIcon
            className="size-6 text-muted-foreground"
            src={`${ASSET_BASE}/icon-cross.svg`}
          />
        </button>
      </header>
      <div className="flex w-full flex-col items-center gap-6 px-6 pt-2 pb-2">
        {evm.eligible ? (
          <SlidingTabs activeTab={tab} onSelect={setTab} tabs={TABS} />
        ) : null}
        {/* transitions.dev "page side-by-side": both tab bodies share one
            grid cell; the active one slides in from its side, the other
            slides out the opposite way with a fade + blur. */}
        <div
          className="t-receive-pages grid w-full justify-items-center"
          data-page={isEvmTab ? "2" : "1"}
        >
          <ReceiveBody
            address={walletAddress}
            copy="Use to receive tokens on the Solana network only. Other assets will be lost forever."
            page="1"
            placeholder="No wallet connected"
          />
          {evm.eligible ? (
            <ReceiveBody
              address={evm.info?.address ?? null}
              copy={
                <>
                  Send USDC, USDT or ETH on{" "}
                  {(evm.info?.chains ?? EVM_CHAIN_FALLBACK)
                    .map((c) => CHAIN_LABELS[c] ?? c)
                    .join(", ")}
                  . It arrives as USDC in your loyal wallet in a few minutes.
                  {evm.info?.minimums.ethereum
                    ? ` Minimum on Ethereum: $${evm.info.minimums.ethereum}.`
                    : null}
                </>
              }
              error={evm.error}
              loading={!evm.info && !evm.error}
              notice={
                <>
                  <span className="flex h-5 shrink-0 items-center rounded-md bg-primary/[0.14] px-1.5 font-medium text-[11px] text-primary uppercase tracking-[0.06px]">
                    Alpha
                  </span>
                  <span className="text-[13px] text-foreground leading-4">
                    Early release. Start with a small amount.
                  </span>
                </>
              }
              page="2"
              placeholder="Preparing your deposit address…"
            />
          ) : null}
        </div>
      </div>
      <div className="w-full px-5 pt-2 pb-4">
        <button
          className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-foreground font-medium text-[16px] text-background leading-5 enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90 enabled:active:translate-y-0 disabled:opacity-40"
          disabled={!shownAddress}
          onClick={handleCopy}
          type="button"
        >
          <TextSwap text={copied ? "Copied!" : "Copy Address"} />
        </button>
      </div>
    </SheetReveal>
  );
}

function ReceiveBody({
  address,
  copy,
  error,
  loading = false,
  notice,
  page,
  placeholder,
}: {
  address: string | null;
  copy: ReactNode;
  error?: string | null;
  loading?: boolean;
  notice?: ReactNode;
  page: "1" | "2";
  placeholder: string;
}) {
  // transitions.dev "skeleton loader and reveal" on the QR + address slot:
  // the skeleton pulses while Privy provisions the address, then both layers
  // cross-fade. Solana's address is known at open, so it reveals at once.
  const revealed = Boolean(address) || Boolean(error);
  return (
    <div
      className="t-receive-page col-start-1 row-start-1 flex w-full flex-col items-center gap-6"
      data-page-id={page}
    >
      <div className="flex flex-col items-center gap-2">
        {notice ? (
          <div className="flex items-center gap-2">{notice}</div>
        ) : null}
        <p className="max-w-[300px] text-center text-[13px] leading-4 text-muted-foreground">
          {copy}
        </p>
      </div>
      <div
        className={`t-skel flex w-full max-w-[280px] flex-col items-center gap-4 rounded-[20px] border border-border p-8 ${
          revealed ? "is-revealed" : ""
        }`}
        style={{ ["--pulse-count" as never]: "infinite" }}
      >
        <div
          aria-hidden="true"
          className={`t-skel-skeleton flex flex-col items-center gap-4 p-8 ${
            loading ? "is-pulsing" : ""
          }`}
        >
          <div className="size-48 rounded-lg bg-accent" />
          <div className="h-8 w-40 rounded-md bg-accent" />
        </div>
        <div className="t-skel-content relative flex flex-col items-center gap-4">
          {address ? (
            <div className="relative">
              <QRCodeSVG
                bgColor="transparent"
                fgColor="var(--foreground)"
                level="M"
                size={192}
                value={address}
              />
              <span className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex h-8 w-10 items-center justify-center rounded bg-card p-0.5">
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
            <div className="size-48 rounded-lg bg-accent" />
          )}
          <p
            className={`break-all text-center text-[13px] leading-4 ${
              error ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {address ?? error ?? placeholder}
          </p>
        </div>
      </div>
    </div>
  );
}
