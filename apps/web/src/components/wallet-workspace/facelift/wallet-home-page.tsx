"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  ScrambledPopDigits,
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
import { WalletHomeBanners } from "@/components/wallet-workspace/facelift/wallet-home-banners";
import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";
import { useAuthCapability } from "@/lib/auth/capability";
import { usePublicEnv } from "@/contexts/public-env-context";
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

// Figma 4813:400022 — the mobile wallet home: address chip + total balance
// over a tile grid (banner, Crypto, Stablecoins, Earn) that fans out to the
// dedicated screens. It's the tab bar's Wallet destination; on desktop the
// sidebar covers this, so the page is only reachable below 796px (resizing
// up mid-visit just shows it as a plain pane).
export function WalletHomePage({
  earnBalanceUsd,
  earnMaxBalanceUsd,
  earnMaxForecastApyBps,
  isEarnBalanceLoading,
  isEarnMaxBalanceLoading,
  onSelectPage,
  onSetUpAutodeposit,
  showActivityBadge,
  showEarnMax,
}: {
  earnBalanceUsd: number;
  earnMaxBalanceUsd: number;
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
                {/* ponytail: settings icon returns when its screen ships */}
                <a
                  aria-label="Visit askloyal.com"
                  className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
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
                    className="t-hover flex size-11 items-center justify-center rounded-3xl enabled:hover:bg-accent disabled:opacity-40"
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
              <div className="grid h-full min-h-[400px] grid-cols-2 grid-rows-[repeat(3,minmax(0,1fr))] gap-2">
                <WalletHomeBanners onSetUpAutodeposit={onSetUpAutodeposit} />
                <button
                  className="t-hover flex flex-col items-start justify-between overflow-clip rounded-3xl bg-accent p-4 text-left hover:bg-accent-selected"
                  onClick={() => onSelectPage("crypto")}
                  type="button"
                >
                  <span className="relative block size-10 shrink-0 overflow-clip rounded-[10px] bg-[#9946fc]">
                    <span className="absolute top-5 left-[6.67px] h-[13.33px] w-[5px] rounded-[1.667px] bg-white" />
                    <span className="absolute top-[6.67px] left-[17.5px] h-[26.67px] w-[5px] rounded-[1.667px] bg-white" />
                    <span className="absolute top-[13.33px] left-[28.33px] h-5 w-[5px] rounded-[1.667px] bg-white" />
                  </span>
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
