"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";

type MobileWallet = {
  /** Wallet-adapter name, so an injected build of this wallet is recognized. */
  name: string;
  icon: string;
  /** Absent when the wallet publishes no link that opens a URL in its browser. */
  browseUrl?: (url: string) => string;
};

// Icons are local copies of each wallet's official mark: phantom.app and
// solflare.com stopped serving the favicons this list used to hotlink (404
// and 403), which rendered as broken images in the modal.
const MOBILE_WALLETS: MobileWallet[] = [
  {
    name: "Phantom",
    icon: "/auth/wallets/phantom.svg",
    browseUrl: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(
        url
      )}?ref=${encodeURIComponent(url)}`,
  },
  {
    name: "Solflare",
    icon: "/auth/wallets/solflare.svg",
    browseUrl: (url: string) =>
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(
        url
      )}?ref=${encodeURIComponent(url)}`,
  },
  // Jupiter Mobile has a dApp browser but publishes no link that opens an
  // arbitrary URL in it — its apple-app-site-association claims only /swap,
  // /ask-for-sol, /invite, /gift, /tokens, /radar, /portfolio and /gacha. So
  // it counts for detection only: inside its browser Jupiter is injected and
  // this list steps aside.
  { name: "Jupiter", icon: "/auth/wallets/jupiter.svg" },
];

const MOBILE_WALLET_NAMES = new Set<string>(
  MOBILE_WALLETS.map((wallet) => wallet.name)
);

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);
  return isMobile;
}

/**
 * True when the page runs in a mobile browser that does not inject one of the
 * wallets above, so reopening the page inside that wallet's own browser is the
 * only way to reach it.
 *
 * Only those wallets count. A browser-native wallet (Brave) is injected and
 * detected too, but it is no help to a Phantom user — and inside Phantom's own
 * browser Phantom is injected, which is exactly where the links must not show.
 */
export function useNeedsMobileWalletBrowser(): boolean {
  const isMobile = useIsMobile();
  const { wallets } = useWallet();
  return (
    isMobile &&
    !wallets.some(
      (candidate) =>
        candidate.readyState === "Installed" &&
        MOBILE_WALLET_NAMES.has(candidate.adapter.name)
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
      {MOBILE_WALLETS.map((wallet) =>
        wallet.browseUrl ? (
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
        ) : null
      )}
    </div>
  );
}
