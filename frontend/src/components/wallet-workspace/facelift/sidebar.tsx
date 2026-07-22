"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { LogOut } from "lucide-react";
import { useMemo, useState } from "react";

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
      style={
        isHidden
          ? { filter: "blur(8px)", userSelect: "none" }
          : undefined
      }
    >
      {whole}
      <span style={{ color: fractionColor }}>{fraction}</span>
    </p>
  );
}

export function FaceliftSidebar() {
  const data = useWalletDesktopData({});
  const publicEnv = usePublicEnv();
  const earnApy = useEarnForecastApy();
  const { isAuthenticated, logout } = useAuthSession();
  const { connected: isWalletConnected, disconnect } = useWallet();
  // The adapter can auto-reconnect without an auth session (stale dev state);
  // disconnect must stay clickable in that half-connected limbo to clear it.
  const canDisconnect = isAuthenticated || isWalletConnected;
  const [isBalanceHidden, setIsBalanceHidden] = useState(false);

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
      <button
        className="flex h-[60px] w-full shrink-0 items-center rounded-2xl px-4 text-left"
        type="button"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="mr-3 size-11 shrink-0"
          src={`${ASSET_BASE}/wallet-logo.svg`}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1">
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
              style={
                isBalanceHidden
                  ? { filter: "blur(10px)", userSelect: "none" }
                  : undefined
              }
            >
              {data.balanceWhole}
              <span className="text-[rgba(60,60,67,0.4)]">
                {data.balanceFraction}
              </span>
            </p>
            <button
              aria-label={isBalanceHidden ? "Show balance" : "Hide balance"}
              onClick={() => setIsBalanceHidden((current) => !current)}
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
            {/* ponytail: zero-deposit screen — live Earn balance wires in when that state is redesigned */}
            <SplitAmount
              fraction=".00"
              fractionColor="#b1b1b4"
              isHidden={isBalanceHidden}
              whole="0"
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

      <div className="w-full pt-2">
        <button
          aria-disabled={!canDisconnect}
          aria-label="Disconnect wallet"
          className="flex size-11 items-center justify-center rounded-2xl text-[#8a8a8e] enabled:hover:bg-black/[0.04] disabled:text-[#d8d8d9]"
          disabled={!canDisconnect}
          onClick={handleDisconnect}
          title={canDisconnect ? "Disconnect wallet" : "Connect a wallet first"}
          type="button"
        >
          <LogOut size={20} strokeWidth={1.8} />
        </button>
      </div>
    </aside>
  );
}
