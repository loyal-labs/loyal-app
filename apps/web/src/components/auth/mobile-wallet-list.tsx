"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";

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

// Privy's embedded wallet is registered with wallet-adapter by the provider
// bridge, so it always reads as installed — only an injected external wallet
// means the browser can connect one.
const BRIDGED_WALLET_NAMES = new Set(["Privy", "Cherry"]);

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);
  return isMobile;
}

/**
 * True when the page runs in a mobile browser that injects no Solana wallet,
 * i.e. the only way to reach Phantom/Solflare is to reopen this page inside
 * the wallet's own browser.
 */
export function useNeedsMobileWalletBrowser(): boolean {
  const isMobile = useIsMobile();
  const { wallets } = useWallet();
  return (
    isMobile &&
    !wallets.some(
      (candidate) =>
        candidate.readyState === "Installed" &&
        !BRIDGED_WALLET_NAMES.has(candidate.adapter.name)
    )
  );
}

export function MobileWalletList() {
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
