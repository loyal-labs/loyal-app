"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  hiddenBalanceStyle,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import { formatEarnApyLabel } from "@/lib/kamino/earn-forecast.shared";
import {
  getStablecoinMintSetForSolanaEnv,
  isStablecoinMint,
} from "@/lib/wallet/stablecoin-classification";

const ASSET_BASE = "/wallet-workspace/facelift";

// Same destinations the old workspace's bottom rail linked to.
const SIDEBAR_LINKS = [
  {
    href: "https://x.com/loyal_hq",
    icon: "icon-x-social.svg",
    label: "Follow Loyal on X",
  },
  {
    href: "https://docs.askloyal.com",
    icon: "icon-docs.svg",
    label: "Documentation",
  },
  {
    href: "https://tally.so/r/ZjRpev",
    icon: "icon-bug.svg",
    label: "Report a bug",
  },
  {
    href: "https://t.me/loyal_tgchat",
    icon: "icon-support.svg",
    label: "Support",
  },
] as const;

function SplitAmount({
  fraction,
  fractionColor = "rgba(60, 60, 67, 0.4)",
  isHidden = false,
  whole,
}: {
  fraction: string;
  fractionColor?: string;
  isHidden?: boolean;
  whole: string;
}) {
  return (
    <p
      className="whitespace-nowrap font-semibold text-[20px] text-black leading-6"
      style={hiddenBalanceStyle(isHidden)}
    >
      {whole}
      <span style={{ color: fractionColor }}>{fraction}</span>
    </p>
  );
}

export function FaceliftSidebar({
  earnBalanceUsd,
}: {
  earnBalanceUsd: number;
}) {
  const data = useWalletDesktopData({});
  const publicEnv = usePublicEnv();
  const earnApy = useEarnForecastApy();
  const { isAuthenticated, logout } = useAuthSession();
  const { connected: isWalletConnected, disconnect } = useWallet();
  // The adapter can auto-reconnect without an auth session (stale dev state);
  // disconnect must stay clickable in that half-connected limbo to clear it.
  const canDisconnect = isAuthenticated || isWalletConnected;
  const { isBalanceHidden, toggleBalanceHidden } = useBalanceVisibility();
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);

  useEffect(() => {
    if (!isWalletMenuOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsWalletMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isWalletMenuOpen]);

  const handleDisconnect = () => {
    void Promise.allSettled([logout(), disconnect()]);
  };

  const stablecoinMints = useMemo(
    () => getStablecoinMintSetForSolanaEnv(publicEnv.solanaEnv),
    [publicEnv.solanaEnv]
  );
  const stablecoinsUsd = useMemo(
    () =>
      data.positions.reduce(
        (sum, position) =>
          isStablecoinMint(position.asset.mint, stablecoinMints)
            ? sum + (position.totalValueUsd ?? 0)
            : sum,
        0
      ),
    [data.positions, stablecoinMints]
  );
  const cryptoUsd = Math.max(data.totalUsd - stablecoinsUsd, 0);
  const stablecoinsBalance = splitUsdBalance(stablecoinsUsd);
  const cryptoBalance = splitUsdBalance(cryptoUsd);
  const earnBalance = splitUsdBalance(earnBalanceUsd);
  // Wallet total (stablecoins + crypto) plus the Earn position.
  const totalBalance = splitUsdBalance(data.totalUsd + earnBalanceUsd);

  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "No account";

  const handleCopyAddress = () => {
    if (data.walletAddress) {
      void navigator.clipboard.writeText(data.walletAddress).catch(() => {});
    }
  };

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-clip p-2">
      <div className="relative flex w-full shrink-0 items-center gap-2.5">
        <button
          className="flex h-[60px] items-center rounded-2xl px-4 text-left hover:bg-black/[0.04]"
          onClick={() => setIsWalletMenuOpen((open) => !open)}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="mr-3 size-11 shrink-0"
            src={`${ASSET_BASE}/wallet-logo.svg`}
          />
          <span className="flex min-w-0 items-center gap-1">
            <span className="whitespace-nowrap text-[16px] text-black leading-5">
              {addressLabel}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Copy address"
              className="size-5 shrink-0 cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                handleCopyAddress();
              }}
              src={`${ASSET_BASE}/icon-copy.svg`}
            />
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="ml-3 size-6 shrink-0"
            src={`${ASSET_BASE}/icon-chevron-down.svg`}
          />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 pl-3">
          {/* ponytail: settings + activity destinations come with later
              screens — buttons unwired for now. */}
          <button
            aria-label="Settings"
            className="flex size-11 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-6"
              src={`${ASSET_BASE}/icon-gear.svg`}
            />
          </button>
          <button
            aria-label="Activity"
            className="flex size-11 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-6"
              src={`${ASSET_BASE}/icon-clock-history.svg`}
            />
          </button>
        </div>

        {isWalletMenuOpen ? (
          <>
            <button
              aria-label="Close wallet menu"
              className="fixed inset-0 z-20 cursor-default"
              onClick={() => setIsWalletMenuOpen(false)}
              type="button"
            />
            {/* Same frosted sheet treatment as the withdraw source select. */}
            <div className="absolute top-[calc(100%+4px)] left-0 z-30 flex w-60 flex-col rounded-2xl bg-white/70 p-2 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] backdrop-blur-[16px]">
              <button
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left font-medium text-[16px] text-black leading-5 enabled:hover:bg-black/[0.04] disabled:text-[#d8d8d9]"
                disabled={!canDisconnect}
                onClick={() => {
                  setIsWalletMenuOpen(false);
                  handleDisconnect();
                }}
                type="button"
              >
                <LogOut size={20} strokeWidth={1.8} />
                Disconnect
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="w-full py-2">
        <div className="flex w-full flex-col gap-0.5 px-4 py-2">
          <div className="flex items-center gap-1">
            <p className="whitespace-nowrap text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
              Total balance
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-5"
              src={`${ASSET_BASE}/icon-question.svg`}
            />
          </div>
          <div className="flex items-center gap-3">
            <p
              className="whitespace-nowrap font-semibold text-[40px] text-black leading-[48px] tracking-[-0.44px]"
              style={hiddenBalanceStyle(isBalanceHidden, "lg")}
            >
              {totalBalance.balanceWhole}
              <span className="text-[rgba(60,60,67,0.4)]">
                {totalBalance.balanceFraction}
              </span>
            </p>
            <button
              aria-label={isBalanceHidden ? "Show balance" : "Hide balance"}
              onClick={toggleBalanceHidden}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/icon-eye.svg`}
              />
            </button>
          </div>
        </div>
      </div>

      <nav className="flex w-full flex-1 flex-col py-2">
        <button
          className="flex w-full items-center rounded-2xl bg-black/[0.04] px-4 text-left"
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="mr-3 size-11 shrink-0"
            src={`${ASSET_BASE}/earn-icon.svg`}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
            <span className="flex items-center gap-1">
              <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                Earn
              </span>
              <span className="inline-flex items-center gap-0.5 rounded-md bg-[rgba(52,199,89,0.14)] px-1 py-px">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-3 w-2"
                  src="/wallet-workspace/earn-flash.svg"
                />
                <span className="whitespace-nowrap pt-px font-medium text-[#34c759] text-[11px] leading-[13px] tracking-[0.06px]">
                  {formatEarnApyLabel(earnApy.apyBps)}
                </span>
              </span>
            </span>
            <SplitAmount
              fraction={earnBalance.balanceFraction}
              fractionColor="#b1b1b4"
              isHidden={isBalanceHidden}
              whole={earnBalance.balanceWhole}
            />
          </span>
        </button>

        <button
          className="flex w-full items-center rounded-2xl px-4 text-left"
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="mr-3 size-11 shrink-0"
            src={`${ASSET_BASE}/stablecoins-icon.svg`}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
            <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
              Stablecoins
            </span>
            <SplitAmount
              fraction={stablecoinsBalance.balanceFraction}
              isHidden={isBalanceHidden}
              whole={stablecoinsBalance.balanceWhole}
            />
          </span>
        </button>

        <button
          className="flex w-full items-center rounded-2xl px-4 text-left"
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="mr-3 size-11 shrink-0"
            src={`${ASSET_BASE}/crypto-icon.svg`}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
            <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
              Crypto
            </span>
            <SplitAmount
              fraction={cryptoBalance.balanceFraction}
              isHidden={isBalanceHidden}
              whole={cryptoBalance.balanceWhole}
            />
          </span>
        </button>
      </nav>

      {/* Design nests the rail in a py-2 section inside the p-2 sidebar, so
          the last row ends 16px above the bottom edge. */}
      <div className="flex w-full flex-col py-2">
        {SIDEBAR_LINKS.map((link) => (
          <a
            className="flex w-full items-center rounded-2xl px-4 hover:bg-black/[0.04]"
            href={link.href}
            key={link.label}
            rel="noreferrer"
            target="_blank"
          >
            <span className="mr-3 flex size-11 shrink-0 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/${link.icon}`}
              />
            </span>
            <span className="py-2 font-medium text-[#8a8a8e] text-[16px] leading-5">
              {link.label}
            </span>
          </a>
        ))}
      </div>
    </aside>
  );
}
