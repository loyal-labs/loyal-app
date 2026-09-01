"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  ScrambledPopDigits,
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import { PaneReveal } from "@/components/wallet-workspace/facelift/pane-transitions";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import type { WorkspacePage } from "@/components/wallet-workspace/facelift/shell";
import { SplitAmount } from "@/components/wallet-workspace/facelift/sidebar";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useEarnForecastApyStatus } from "@/components/wallet-workspace/facelift/use-earn-forecast-apy-status";
import {
  FirstDepositBanner,
  WalletHomeBanners,
} from "@/components/wallet-workspace/facelift/wallet-home-banners";
import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";
import { useAuthCapability } from "@/lib/auth/capability";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import {
  formatEarnApyLabel,
  formatEarnApyPercent,
} from "@/lib/kamino/earn-forecast.shared";
import {
  getStablecoinMintSetForSolanaEnv,
  isStablecoinMint,
} from "@/lib/wallet/stablecoin-classification";

const ASSET_BASE = "/wallet-workspace/facelift";

// ponytail: rough fee/rent buffer — tune when a real preflight estimate exists
const LOW_SOL_WARNING_THRESHOLD = 0.01;

// The purple crypto stash mark, drawn at its 40px art size; smaller usages
// scale the wrapper (the bar offsets are absolute pixels).
function CryptoStashIcon({ scale = 1 }: { scale?: number }) {
  return (
    <span
      className="relative block size-10 shrink-0 origin-top-left overflow-clip rounded-[10px] bg-[#9946fc]"
      style={
        scale === 1
          ? undefined
          : { marginBottom: 40 * (scale - 1), marginRight: 40 * (scale - 1), transform: `scale(${scale})` }
      }
    >
      <span className="absolute top-5 left-[6.67px] h-[13.33px] w-[5px] rounded-[1.667px] bg-white" />
      <span className="absolute top-[6.67px] left-[17.5px] h-[26.67px] w-[5px] rounded-[1.667px] bg-white" />
      <span className="absolute top-[13.33px] left-[28.33px] h-5 w-[5px] rounded-[1.667px] bg-white" />
    </span>
  );
}

// Figma 5465:83214/83228 — compact Stablecoins/Crypto summary rows on the
// mobile home.
function MobileSummaryRow({
  amount,
  icon,
  isHidden,
  isRevealed,
  label,
  onSelect,
  warningLabel,
}: {
  amount: { balanceFraction: string; balanceWhole: string };
  icon: ReactNode;
  isHidden: boolean;
  isRevealed: boolean;
  label: string;
  onSelect: () => void;
  /** Red triangle after the amount (Figma 5465:83239's low-SOL warning). */
  warningLabel?: string | null;
}) {
  return (
    <button
      className="t-hover flex min-w-0 flex-1 items-center rounded-2xl px-4 text-left hover:bg-accent"
      onClick={onSelect}
      type="button"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
        <span className="flex items-center gap-1.5">
          {icon}
          <span className="flex items-center">
            <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
              {label}
            </span>
            <ThemedIcon
              className="size-4 text-tertiary"
              src={`${ASSET_BASE}/icon-chevron-right.svg`}
            />
          </span>
        </span>
        <span className="flex items-center gap-1">
          <SplitAmount
            fraction={amount.balanceFraction}
            isHidden={isHidden}
            isRevealed={isRevealed}
            whole={amount.balanceWhole}
          />
          {warningLabel ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={warningLabel}
              className="size-5 shrink-0"
              src={`${ASSET_BASE}/icon-warning-triangle.svg`}
              title={warningLabel}
            />
          ) : null}
        </span>
      </span>
    </button>
  );
}

// Figma 5465:83244 (empty) / 5465:83355 (deposited) — the tall Earn and
// Earn MAX product cards on the mobile home.
function MobileProductCard({
  apyBadgeLabel,
  balance,
  earned30dUsd,
  hasDeposit,
  icon,
  isBalanceHidden,
  isRevealed,
  name,
  onSelect,
}: {
  apyBadgeLabel: string;
  balance: { balanceFraction: string; balanceWhole: string };
  earned30dUsd: number | null;
  hasDeposit: boolean;
  icon: ReactNode;
  isBalanceHidden: boolean;
  isRevealed: boolean;
  name: string;
  onSelect: () => void;
}) {
  return (
    <button
      className="t-hover relative flex flex-col items-start justify-between overflow-clip rounded-3xl bg-accent p-4 text-left hover:bg-accent-selected"
      onClick={onSelect}
      type="button"
    >
      <span className="flex w-full items-center gap-2">
        {icon}
        <span className="whitespace-nowrap font-medium text-[16px] text-foreground leading-5">
          {name}
        </span>
      </span>
      {hasDeposit ? (
        <span className="flex w-full flex-col gap-0.5">
          <span className="mb-0.5 inline-flex w-fit items-center rounded-md bg-positive/[0.14] px-1 py-px">
            <span className="whitespace-nowrap pt-px font-medium text-[11px] text-positive leading-[13px] tracking-[0.06px]">
              {apyBadgeLabel}
            </span>
          </span>
          <SplitAmount
            fraction={balance.balanceFraction}
            isHidden={isBalanceHidden}
            isRevealed={isRevealed}
            whole={balance.balanceWhole}
          />
          {earned30dUsd !== null && Math.abs(earned30dUsd) >= 0.005 ? (
            <span
              className={`whitespace-nowrap text-[13px] leading-4 ${
                earned30dUsd >= 0 ? "text-positive" : "text-destructive"
              }`}
            >
              <ScrambleText
                isHidden={isBalanceHidden}
                text={`${earned30dUsd >= 0 ? "+" : "-"}$${Math.abs(
                  earned30dUsd
                ).toFixed(2)} (30D)`}
              />
            </span>
          ) : null}
        </span>
      ) : (
        <>
          {/* Centered a touch above the middle, clear of the APY block. */}
          <span className="-translate-x-1/2 -translate-y-1/2 absolute top-[calc(50%-11px)] left-1/2 flex flex-col items-center gap-1">
            <ThemedIcon
              className="size-9 text-tertiary"
              src={`${ASSET_BASE}/icon-plus.svg`}
            />
            <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground tracking-[0.06px]">
              Start earning
            </span>
          </span>
          <span className="flex flex-col gap-1">
            <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
              Average APY
            </span>
            <span className="inline-flex w-fit items-center rounded-lg bg-positive/[0.14] px-2 py-0.5">
              <span className="whitespace-nowrap font-medium text-[16px] text-positive leading-5 tracking-[0.06px]">
                {apyBadgeLabel}
              </span>
            </span>
          </span>
        </>
      )}
    </button>
  );
}

// Figma 4813:400022 — the mobile wallet home: address chip + total balance
// over a tile grid (banner, Crypto, Stablecoins, Earn) that fans out to the
// dedicated screens. It's the tab bar's Wallet destination; on desktop the
// sidebar covers this, so the page is only reachable below 796px (resizing
// up mid-visit just shows it as a plain pane).
export function WalletHomePage({
  earnBalanceUsd,
  earnEarned30dUsd,
  earnMaxBalanceUsd,
  earnMaxEarned30dUsd,
  earnMaxForecastApyBps,
  isEarnBalanceLoading,
  isEarnMaxBalanceLoading,
  onOpenSettings,
  onSelectPage,
  onSetUpAutodeposit,
  showActivityBadge,
  showEarnMax,
}: {
  onOpenSettings: () => void;
  earnBalanceUsd: number;
  /** 30-day earned sums for the mobile product cards; null while loading. */
  earnEarned30dUsd: number | null;
  earnMaxBalanceUsd: number;
  earnMaxEarned30dUsd: number | null;
  earnMaxForecastApyBps: number | null;
  isEarnBalanceLoading: boolean;
  isEarnMaxBalanceLoading: boolean;
  onSelectPage: (page: WorkspacePage) => void;
  onSetUpAutodeposit: () => void;
  showActivityBadge: boolean;
  showEarnMax: boolean;
}) {
  const data = useWalletDesktopData({});
  const publicEnv = usePublicEnv();
  const { apy: earnApy, isLoaded: isApyLoaded } = useEarnForecastApyStatus();
  const { isHydrated, isSignedIn } = useAuthCapability();
  const { isAuthenticated, logout } = useAuthSession();
  const cherryRuntime = useCherryRuntime();
  const { connected: isWalletConnected, disconnect } = useWallet();
  // Same half-connected limbo rule as the sidebar: the adapter can
  // auto-reconnect without an auth session, so disconnect stays clickable
  // whenever either side is live.
  const canDisconnect = isAuthenticated || isWalletConnected;
  const { isBalanceHidden, toggleBalanceHidden } = useBalanceVisibility();
  const { open: openSignIn } = useSignInModal();

  const handleDisconnect = () => {
    void Promise.allSettled([logout(), disconnect()]);
  };

  // Same split the sidebar computes: stablecoins by mint, crypto = rest.
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
  const stablecoinsBalance = splitUsdBalance(stablecoinsUsd);
  const cryptoBalance = splitUsdBalance(
    Math.max(data.totalUsd - stablecoinsUsd, 0)
  );
  const earnBalance = splitUsdBalance(earnBalanceUsd);
  const earnMaxBalance = splitUsdBalance(earnMaxBalanceUsd);
  const earnMaxApyLabel =
    earnMaxForecastApyBps === null
      ? "—"
      : `${(earnMaxForecastApyBps / 100).toFixed(2)}%`;
  const totalBalance = splitUsdBalance(
    data.totalUsd + earnBalanceUsd + (showEarnMax ? earnMaxBalanceUsd : 0)
  );

  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "No account";
  const isAddressRevealed =
    isHydrated && (!isSignedIn || data.walletAddress !== null);
  const isWalletDataRevealed =
    isHydrated &&
    (!isSignedIn || (data.walletAddress !== null && !data.isLoading));
  const isEarnBalanceRevealed = !isEarnBalanceLoading;
  const isEarnMaxBalanceRevealed = !isEarnMaxBalanceLoading;
  const isTotalRevealed =
    isWalletDataRevealed &&
    isEarnBalanceRevealed &&
    (!showEarnMax || isEarnMaxBalanceRevealed);

  // Copied feedback, same icon swap the sidebar chip uses.
  const [isCopied, setIsCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    []
  );
  const handleCopyAddress = () => {
    const address = data.walletAddress;
    if (!address) {
      return;
    }
    void copyTextToClipboard(address).then((didCopy) => {
      if (!didCopy) {
        return;
      }
      setIsCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setIsCopied(false);
      }, 1500);
    });
  };

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
        <PaneReveal>
          <section className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-3xl bg-card max-[795px]:rounded-none">
            <div className="flex w-full shrink-0 items-center gap-2.5 pr-2 pl-1">
              {isHydrated && !isSignedIn ? (
                <button
                  className="t-hover flex h-[60px] items-center rounded-2xl px-3 text-left hover:bg-accent"
                  onClick={openSignIn}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="mr-3 size-11 shrink-0 rounded-[11px]"
                    src="/agents/Agent-01.svg"
                  />
                  <span className="whitespace-nowrap text-[16px] text-foreground leading-5">
                    {cherryRuntime.mode === "cherry_embedded"
                      ? "Verify account"
                      : "Connect account"}
                  </span>
                </button>
              ) : (
                <div className="flex h-[60px] items-center rounded-2xl px-3">
                  {/* Same Main Account image the desktop sidebar chip uses. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="mr-3 size-11 shrink-0 rounded-[11px]"
                    src="/agents/Agent-01.svg"
                  />
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="whitespace-nowrap text-[16px] text-foreground leading-5">
                      <SkeletonReveal
                        isRevealed={isAddressRevealed}
                        skeletonClassName="rounded-md bg-accent-selected"
                      >
                        <TextSwap text={addressLabel} />
                      </SkeletonReveal>
                    </span>
                    <span
                      className="t-icon-swap size-5 shrink-0 cursor-pointer"
                      data-state={isCopied ? "b" : "a"}
                      onClick={handleCopyAddress}
                    >
                      <span
                        aria-label="Copy address"
                        className="t-icon icon-themed size-5 text-tertiary"
                        data-icon="a"
                        role="img"
                        style={
                          {
                            "--icon": `url("${ASSET_BASE}/icon-copy.svg")`,
                          } as CSSProperties
                        }
                      />
                      <span
                        aria-hidden="true"
                        className="t-icon icon-themed size-5 text-tertiary"
                        data-icon="b"
                        style={
                          {
                            "--icon": `url("${ASSET_BASE}/icon-check.svg")`,
                          } as CSSProperties
                        }
                      />
                    </span>
                  </span>
                </div>
              )}
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1 pl-3">
                {/* Figma 5465:83164 — mobile replaces the quick links with
                    the settings gear (links live in the sheet). */}
                <button
                  aria-label="Open settings"
                  className="t-hover hidden size-11 items-center justify-center rounded-3xl hover:bg-accent max-[795px]:flex"
                  onClick={onOpenSettings}
                  type="button"
                >
                  <ThemedIcon
                    className="size-6 text-tertiary"
                    src={`${ASSET_BASE}/icon-gear.svg`}
                  />
                </button>
                <a
                  aria-label="Visit askloyal.com"
                  className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent max-[795px]:hidden"
                  href="https://askloyal.com"
                >
                  <ThemedIcon
                    className="size-6 text-tertiary"
                    src={`${ASSET_BASE}/icon-globe.svg`}
                  />
                </a>
                {cherryRuntime.mode === "standalone" ? (
                  <button
                    aria-label="Disconnect wallet"
                    className="t-hover flex size-11 items-center justify-center rounded-3xl enabled:hover:bg-accent disabled:opacity-40 max-[795px]:hidden"
                    disabled={!canDisconnect}
                    onClick={handleDisconnect}
                    type="button"
                  >
                    <ThemedIcon
                      className="size-6 text-tertiary"
                      src={`${ASSET_BASE}/icon-logout.svg`}
                    />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="w-full shrink-0 py-2">
              <div className="flex w-full flex-col gap-0.5 px-4 py-2">
                <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                  Total balance
                </p>
                <div className="flex items-center gap-3">
                  <p className="whitespace-nowrap font-semibold text-[40px] text-foreground leading-[48px] tracking-[-0.44px]">
                    <SkeletonReveal
                      isRevealed={isTotalRevealed}
                      skeletonClassName="rounded-lg bg-accent-selected"
                    >
                      {isTotalRevealed ? (
                        <ScrambledPopDigits
                          isHidden={isBalanceHidden}
                          segments={[
                            { text: totalBalance.balanceWhole },
                            {
                              color: "var(--tertiary)",
                              text: totalBalance.balanceFraction,
                            },
                          ]}
                        />
                      ) : (
                        `${totalBalance.balanceWhole}${totalBalance.balanceFraction}`
                      )}
                    </SkeletonReveal>
                  </p>
                  <button
                    aria-label={
                      isBalanceHidden ? "Show balance" : "Hide balance"
                    }
                    className="t-hover -m-2.5 flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent"
                    onClick={toggleBalanceHidden}
                    type="button"
                  >
                    <ThemedIcon
                      className="size-6 text-tertiary"
                      src={`${ASSET_BASE}/icon-eye.svg`}
                    />
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 w-full flex-1 px-4 py-2">
              <div className="grid h-full min-h-[400px] grid-cols-2 grid-rows-[repeat(3,minmax(0,1fr))] gap-2 max-[795px]:hidden">
                <WalletHomeBanners onSetUpAutodeposit={onSetUpAutodeposit} />
                <button
                  className="t-hover flex flex-col items-start justify-between overflow-clip rounded-3xl bg-accent p-4 text-left hover:bg-accent-selected"
                  onClick={() => onSelectPage("crypto")}
                  type="button"
                >
                  <CryptoStashIcon />
                  <span className="flex w-full flex-col gap-1">
                    <span className="text-[15px] leading-5 text-muted-foreground">
                      Crypto
                    </span>
                    <SplitAmount
                      fraction={cryptoBalance.balanceFraction}
                      isHidden={isBalanceHidden}
                      isRevealed={isWalletDataRevealed}
                      whole={cryptoBalance.balanceWhole}
                    />
                  </span>
                </button>
                <button
                  className="t-hover flex flex-col items-start justify-between overflow-clip rounded-3xl bg-accent p-4 text-left hover:bg-accent-selected"
                  onClick={() => onSelectPage("earn")}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="size-10 shrink-0"
                    src={`${ASSET_BASE}/earn-icon.svg`}
                  />
                  <span className="flex w-full flex-col gap-1">
                    <span className="flex items-center gap-1">
                      <span className="whitespace-nowrap font-semibold text-[15px] text-foreground leading-5">
                        Earn
                      </span>
                      <SkeletonReveal
                        isRevealed={isApyLoaded}
                        skeletonClassName="rounded-md bg-accent-selected"
                      >
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-positive/[0.14] px-1 py-px">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            aria-hidden="true"
                            className="h-3 w-2"
                            src="/wallet-workspace/earn-flash.svg"
                          />
                          <span className="whitespace-nowrap pt-px font-medium text-positive text-[11px] leading-[13px] tracking-[0.06px]">
                            {isApyLoaded ? (
                              <PopDigits
                                segments={[
                                  { text: formatEarnApyLabel(earnApy.apyBps) },
                                ]}
                              />
                            ) : (
                              formatEarnApyLabel(earnApy.apyBps)
                            )}
                          </span>
                        </span>
                      </SkeletonReveal>
                    </span>
                    <SplitAmount
                      fraction={earnBalance.balanceFraction}
                      isHidden={isBalanceHidden}
                      isRevealed={isEarnBalanceRevealed}
                      whole={earnBalance.balanceWhole}
                    />
                  </span>
                </button>
                <button
                  className="t-hover flex flex-col items-start justify-between overflow-clip rounded-3xl bg-accent p-4 text-left hover:bg-accent-selected"
                  onClick={() => onSelectPage("stables")}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="size-10 shrink-0"
                    src={`${ASSET_BASE}/stash-stablecoins.svg`}
                  />
                  <span className="flex w-full flex-col gap-1">
                    <span className="text-[15px] leading-5 text-muted-foreground">
                      Stablecoins
                    </span>
                    <SplitAmount
                      fraction={stablecoinsBalance.balanceFraction}
                      isHidden={isBalanceHidden}
                      isRevealed={isWalletDataRevealed}
                      whole={stablecoinsBalance.balanceWhole}
                    />
                  </span>
                </button>
                {showEarnMax ? (
                  <button
                    className="t-hover flex flex-col items-start justify-between overflow-clip rounded-3xl bg-accent p-4 text-left hover:bg-accent-selected"
                    onClick={() => onSelectPage("earnmax")}
                    type="button"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      aria-hidden="true"
                      className="size-10 shrink-0 rounded-[10px]"
                      src={`${ASSET_BASE}/earn-max-icon.svg`}
                    />
                    <span className="flex w-full flex-col gap-1">
                      <span className="flex items-center gap-1">
                        <span className="whitespace-nowrap font-semibold text-[15px] text-foreground leading-5">
                          Earn MAX
                        </span>
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-positive/[0.14] px-1 py-px">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            aria-hidden="true"
                            className="h-3 w-2"
                            src="/wallet-workspace/earn-flash.svg"
                          />
                          <span className="whitespace-nowrap pt-px font-medium text-positive text-[11px] leading-[13px] tracking-[0.06px]">
                            {earnMaxApyLabel}
                          </span>
                        </span>
                      </span>
                      <SplitAmount
                        fraction={earnMaxBalance.balanceFraction}
                        isHidden={isBalanceHidden}
                        isRevealed={isEarnMaxBalanceRevealed}
                        whole={earnMaxBalance.balanceWhole}
                      />
                    </span>
                  </button>
                ) : null}
              </div>

              {/* Figma 5465:83164 / 5465:83340 — mobile home: banner slot,
                  Stablecoins/Crypto summary rows, then the tall Earn and
                  Earn MAX product cards. */}
              <div className="hidden h-full min-h-0 flex-col max-[795px]:flex">
                <div className="relative h-24 w-full shrink-0">
                  {earnBalanceUsd > 0 ||
                  (showEarnMax && earnMaxBalanceUsd > 0) ? (
                    <WalletHomeBanners
                      dotsBelow
                      onSetUpAutodeposit={onSetUpAutodeposit}
                    />
                  ) : (
                    <FirstDepositBanner />
                  )}
                </div>
                <div className="flex w-full shrink-0 items-start gap-2 py-2 pt-7">
                  <MobileSummaryRow
                    amount={stablecoinsBalance}
                    icon={
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        aria-hidden="true"
                        className="size-6 shrink-0"
                        src={`${ASSET_BASE}/stash-stablecoins.svg`}
                      />
                    }
                    isHidden={isBalanceHidden}
                    isRevealed={isWalletDataRevealed}
                    label="Stablecoins"
                    onSelect={() => onSelectPage("stables")}
                  />
                  <MobileSummaryRow
                    amount={cryptoBalance}
                    icon={<CryptoStashIcon scale={0.6} />}
                    isHidden={isBalanceHidden}
                    isRevealed={isWalletDataRevealed}
                    label="Crypto"
                    onSelect={() => onSelectPage("crypto")}
                    warningLabel={
                      isWalletDataRevealed &&
                      (data.totalSol ?? 0) < LOW_SOL_WARNING_THRESHOLD
                        ? "Not enough SOL to process deposits or withdrawals"
                        : null
                    }
                  />
                </div>
                <div
                  className={`grid min-h-0 w-full flex-1 gap-2 pb-2 ${
                    showEarnMax ? "grid-cols-2" : "grid-cols-1"
                  }`}
                >
                  <MobileProductCard
                    apyBadgeLabel={
                      earnBalanceUsd > 0
                        ? formatEarnApyLabel(earnApy.apyBps)
                        : formatEarnApyPercent(earnApy.apyBps)
                    }
                    balance={earnBalance}
                    earned30dUsd={earnEarned30dUsd}
                    hasDeposit={earnBalanceUsd > 0}
                    icon={
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        aria-hidden="true"
                        className="size-6 shrink-0"
                        src={`${ASSET_BASE}/earn-icon.svg`}
                      />
                    }
                    isBalanceHidden={isBalanceHidden}
                    isRevealed={isEarnBalanceRevealed}
                    name="Earn"
                    onSelect={() => onSelectPage("earn")}
                  />
                  {showEarnMax ? (
                    <MobileProductCard
                      apyBadgeLabel={
                        earnMaxBalanceUsd > 0
                          ? `${earnMaxApyLabel} APY`
                          : earnMaxApyLabel
                      }
                      balance={earnMaxBalance}
                      earned30dUsd={earnMaxEarned30dUsd}
                      hasDeposit={earnMaxBalanceUsd > 0}
                      icon={
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt=""
                          aria-hidden="true"
                          className="size-6 shrink-0 rounded-md"
                          src={`${ASSET_BASE}/earn-max-icon.svg`}
                        />
                      }
                      isBalanceHidden={isBalanceHidden}
                      isRevealed={isEarnMaxBalanceRevealed}
                      name="Earn MAX"
                      onSelect={() => onSelectPage("earnmax")}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </PaneReveal>
      </div>
      <MobileTabBar
        activeTab="wallet"
        onSelect={onSelectPage}
        showActivityBadge={showActivityBadge}
      />
    </>
  );
}
