"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Moon, Sun } from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ScrambledPopDigits,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import { DropdownReveal } from "@/components/wallet-workspace/facelift/dropdown-reveal";
import {
  EARN_MAX_APY_LABEL,
  EARN_MAX_BALANCE_USD,
} from "@/components/wallet-workspace/facelift/earn-max-pane";
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import { ReceiveSheet } from "@/components/wallet-workspace/facelift/receive-sheet";
import type { WorkspacePage } from "@/components/wallet-workspace/facelift/shell";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useEarnForecastApyStatus } from "@/components/wallet-workspace/facelift/use-earn-forecast-apy-status";
import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";
import { useAuthCapability } from "@/lib/auth/capability";
import { usePublicEnv } from "@/contexts/public-env-context";
import { captureBrowserLoadingMetricAfterPaint } from "@/features/observability/client";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import { useTheme } from "@/hooks/use-theme";
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
  {
    href: "https://askloyal.com",
    icon: "icon-globe.svg",
    label: "Visit askloyal.com",
  },
] as const;

export function SplitAmount({
  fraction,
  fractionColor = "var(--tertiary)",
  isHidden = false,
  isRevealed,
  whole,
}: {
  fraction: string;
  fractionColor?: string;
  isHidden?: boolean;
  isRevealed: boolean;
  whole: string;
}) {
  return (
    <p className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
      <SkeletonReveal
        isRevealed={isRevealed}
        skeletonClassName="rounded-md bg-accent-selected"
      >
        {isRevealed ? (
          <ScrambledPopDigits
            isHidden={isHidden}
            segments={[
              { text: whole },
              { color: fractionColor, text: fraction },
            ]}
          />
        ) : (
          // Invisible placeholder sizes the skeleton bar.
          `${whole}${fraction}`
        )}
      </SkeletonReveal>
    </p>
  );
}

// Hover-revealed kbd hint for the section shortcuts; lights up red when the
// shell reports the key was just pressed.
function ShortcutKey({
  isFlashed,
  letter,
}: {
  isFlashed: boolean;
  letter: string;
}) {
  return (
    <kbd
      className={`flex h-4 min-w-4 items-center justify-center rounded-[5px] px-0.5 font-medium font-sans text-[11px] leading-none ${
        isFlashed
          ? // A keypress lands instantly, so its feedback must too — only the
            // fade-out (the unflashed state's transition) is animated.
            "bg-primary text-white opacity-100 transition-none"
          : "bg-accent-selected text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      }`}
    >
      {letter}
    </kbd>
  );
}

export function FaceliftSidebar({
  activePage,
  earnBalanceUsd,
  flashedShortcut,
  isEarnBalanceLoading,
  onSelectPage,
  onUnseenActivityChange,
}: {
  activePage: WorkspacePage;
  earnBalanceUsd: number;
  /** Section whose shortcut key was just pressed — flashes its kbd hint. */
  flashedShortcut: WorkspacePage | null;
  isEarnBalanceLoading: boolean;
  onSelectPage: (page: WorkspacePage) => void;
  onUnseenActivityChange?: (hasUnseen: boolean) => void;
}) {
  const data = useWalletDesktopData({});
  const publicEnv = usePublicEnv();
  const { apy: earnApy, isLoaded: isApyLoaded } = useEarnForecastApyStatus();
  const { isHydrated, isSignedIn } = useAuthCapability();
  const { isAuthenticated, logout } = useAuthSession();
  const cherryRuntime = useCherryRuntime();
  const { connected: isWalletConnected, disconnect } = useWallet();
  // The adapter can auto-reconnect without an auth session (stale dev state);
  // disconnect must stay clickable in that half-connected limbo to clear it.
  const canDisconnect = isAuthenticated || isWalletConnected;
  const { isBalanceHidden, toggleBalanceHidden } = useBalanceVisibility();
  const { open: openSignIn } = useSignInModal();
  const { isDark, toggleTheme } = useTheme();
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);

  useEffect(() => {
    if (!isWalletMenuOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsWalletMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isWalletMenuOpen]);

  const handleDisconnect = () => {
    void Promise.allSettled([logout(), disconnect()]);
  };

  // Unseen-activity badge: activity is a lazy fetch, so kick it once the
  // wallet lands; "seen" is the newest row timestamp at the last Activity
  // visit, persisted per wallet. ponytail: the Activity page fetches through
  // its own hook instance — both read the same client cache, so the newest
  // row here is close enough to mark seen from.
  const loadActivity = data.loadActivity;
  useEffect(() => {
    if (data.walletAddress) {
      void loadActivity();
    }
  }, [data.walletAddress, loadActivity]);
  const latestActivityAt = data.allActivityRows[0]?.rawTimestamp ?? 0;
  const activitySeenKey = data.walletAddress
    ? `loyal:activity-seen:${data.walletAddress}`
    : null;
  const [activitySeenAt, setActivitySeenAt] = useState(0);
  useEffect(() => {
    if (!activitySeenKey) {
      setActivitySeenAt(0);
      return;
    }
    const stored = Number(localStorage.getItem(activitySeenKey) ?? "0");
    setActivitySeenAt(Number.isFinite(stored) ? stored : 0);
  }, [activitySeenKey]);
  useEffect(() => {
    if (activePage === "activity" && activitySeenKey && latestActivityAt > 0) {
      localStorage.setItem(activitySeenKey, String(latestActivityAt));
      setActivitySeenAt(latestActivityAt);
    }
  }, [activePage, activitySeenKey, latestActivityAt]);
  const hasUnseenActivity =
    activePage !== "activity" && latestActivityAt > activitySeenAt;
  // The sidebar stays mounted (CSS-hidden) below 796px, so it keeps owning
  // the unseen state; the shell mirrors it for the mobile tab bar's badge.
  useEffect(() => {
    onUnseenActivityChange?.(hasUnseenActivity);
  }, [hasUnseenActivity, onUnseenActivityChange]);

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
  const earnMaxBalance = splitUsdBalance(EARN_MAX_BALANCE_USD);
  // Wallet total (stablecoins + crypto) plus the Earn position.
  const totalBalance = splitUsdBalance(data.totalUsd + earnBalanceUsd);

  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "No account";

  // Skeleton every non-final value on boot instead of animating through
  // intermediate states: hydration gates the address; the wallet fetch gates
  // stablecoins/crypto; the position resolve gates earn; Total needs BOTH
  // (it used to pop three times: 0 → wallet-only → wallet+earn). Signed-out
  // zeros after hydration ARE final, so they reveal immediately.
  const isAddressRevealed =
    isHydrated && (!isSignedIn || data.walletAddress !== null);
  const isWalletDataRevealed =
    isHydrated &&
    (!isSignedIn || (data.walletAddress !== null && !data.isLoading));
  const isEarnBalanceRevealed = !isEarnBalanceLoading;
  const isTotalRevealed = isWalletDataRevealed && isEarnBalanceRevealed;
  const hasReportedBalancesReadyRef = useRef(false);
  useEffect(() => {
    if (
      hasReportedBalancesReadyRef.current ||
      !isSignedIn ||
      !isTotalRevealed
    ) {
      return;
    }

    hasReportedBalancesReadyRef.current = true;
    captureBrowserLoadingMetricAfterPaint({
      operation: "page_load",
      phase: "balances_ready",
      startedAtMs: 0,
    });
  }, [isSignedIn, isTotalRevealed]);

  // Copied feedback: the copy icon swaps to a check, then back.
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
  const showCopied = () => {
    setIsCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setIsCopied(false);
    }, 1500);
  };

  const handleCopyAddress = () => {
    const address = data.walletAddress;
    if (!address) {
      return;
    }
    void copyTextToClipboard(address).then((didCopy) => {
      if (didCopy) {
        showCopied();
      }
    });
  };

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-clip p-2 max-[795px]:hidden">
      {/* Figma 4768:102489 — logo on top, wallet chip moved to the bottom. */}
      <div className="flex h-[60px] w-full shrink-0 items-center">
        <ThemedIcon
          className="ml-4 h-6 w-14 text-foreground"
          label="Loyal"
          src={`${ASSET_BASE}/logotype.svg`}
        />
        <div className="flex min-w-0 flex-1 items-center justify-end pl-3">
          <span className="group flex items-center gap-1.5">
            <ShortcutKey
              isFlashed={flashedShortcut === "activity"}
              letter="A"
            />
            <button
              aria-label="Activity"
              className={`t-hover relative flex size-11 items-center justify-center rounded-3xl ${
                activePage === "activity" ? "bg-accent" : "hover:bg-accent"
              }`}
              onClick={() => onSelectPage("activity")}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-tertiary"
                src={`${ASSET_BASE}/icon-clock-history.svg`}
              />
              {/* transitions.dev notification badge: pops in when wallet
                activity newer than the last Activity visit lands. */}
              <span
                className="t-badge t-badge-activity"
                data-open={hasUnseenActivity ? "true" : "false"}
              >
                <span className="t-badge-dot size-1.5 rounded-full bg-primary" />
              </span>
            </button>
          </span>
        </div>
      </div>

      <div className="w-full py-2">
        <div className="flex w-full flex-col gap-0.5 px-4 py-2">
          <div className="flex items-center gap-1">
            <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
              Total balance
            </p>
            {/* ponytail: mock tooltip copy — real copy comes with the wiring pass */}
            <InfoTooltip text="Wallet and Earn balances combined" />
          </div>
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
                  // Invisible placeholder sizes the skeleton bar.
                  `${totalBalance.balanceWhole}${totalBalance.balanceFraction}`
                )}
              </SkeletonReveal>
            </p>
            <button
              aria-label={isBalanceHidden ? "Show balance" : "Hide balance"}
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

      <nav className="flex w-full flex-1 flex-col py-2">
        <button
          className={`t-hover group flex w-full items-center rounded-2xl px-4 text-left ${
            activePage === "earn" ? "bg-accent" : "hover:bg-accent"
          }`}
          onClick={() => onSelectPage("earn")}
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
              <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                Earn
              </span>
              {/* Skeleton the whole pill until the real APY lands, then
                  reveal + pop the digits (the hook's fallback APY is a
                  hardcoded number that would otherwise flash and re-pop). */}
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
              <ShortcutKey isFlashed={flashedShortcut === "earn"} letter="E" />
            </span>
            <SplitAmount
              fraction={earnBalance.balanceFraction}
              fractionColor="var(--tertiary)"
              isHidden={isBalanceHidden}
              isRevealed={isEarnBalanceRevealed}
              whole={earnBalance.balanceWhole}
            />
          </span>
        </button>

        {/* Mocked Earn MAX row — static balance/APY, no live feed yet. */}
        <button
          className={`t-hover group flex w-full items-center rounded-2xl px-4 text-left ${
            activePage === "earnmax" ? "bg-accent" : "hover:bg-accent"
          }`}
          onClick={() => onSelectPage("earnmax")}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="mr-3 size-11 shrink-0"
            src={`${ASSET_BASE}/earn-max-icon.svg`}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
            <span className="flex items-center gap-1">
              <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
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
                  {EARN_MAX_APY_LABEL}
                </span>
              </span>
              <ShortcutKey
                isFlashed={flashedShortcut === "earnmax"}
                letter="M"
              />
            </span>
            <SplitAmount
              fraction={earnMaxBalance.balanceFraction}
              isHidden={isBalanceHidden}
              isRevealed
              whole={earnMaxBalance.balanceWhole}
            />
          </span>
        </button>

        <button
          className={`t-hover group flex w-full items-center rounded-2xl px-4 text-left ${
            activePage === "stables" ? "bg-accent" : "hover:bg-accent"
          }`}
          onClick={() => onSelectPage("stables")}
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
            <span className="flex items-center gap-1">
              <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                Stablecoins
              </span>
              <ShortcutKey
                isFlashed={flashedShortcut === "stables"}
                letter="S"
              />
            </span>
            <SplitAmount
              fraction={stablecoinsBalance.balanceFraction}
              isHidden={isBalanceHidden}
              isRevealed={isWalletDataRevealed}
              whole={stablecoinsBalance.balanceWhole}
            />
          </span>
        </button>

        <button
          className={`t-hover group flex w-full items-center rounded-2xl px-4 text-left ${
            activePage === "crypto" ? "bg-accent" : "hover:bg-accent"
          }`}
          onClick={() => onSelectPage("crypto")}
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
            <span className="flex items-center gap-1">
              <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                Crypto
              </span>
              <ShortcutKey
                isFlashed={flashedShortcut === "crypto"}
                letter="C"
              />
            </span>
            <SplitAmount
              fraction={cryptoBalance.balanceFraction}
              isHidden={isBalanceHidden}
              isRevealed={isWalletDataRevealed}
              whole={cryptoBalance.balanceWhole}
            />
          </span>
        </button>
      </nav>

      <div className="flex w-full flex-col py-2">
        {SIDEBAR_LINKS.map((link) => (
          <a
            className="t-hover flex w-full items-center rounded-2xl px-4 hover:bg-accent"
            href={link.href}
            key={link.label}
            rel="noreferrer"
            target="_blank"
          >
            <span className="mr-3 flex size-11 shrink-0 items-center justify-center">
              <ThemedIcon
                className="size-6 text-tertiary"
                src={`${ASSET_BASE}/${link.icon}`}
              />
            </span>
            <span className="py-2 font-medium text-muted-foreground text-[16px] leading-5">
              {link.label}
            </span>
          </a>
        ))}
      </div>

      {/* Figma 4768:102489 — bottom rail: wallet chip left, Receive +
          Settings right; the wallet menu now grows upward from the chip.
          Signed out it collapses to a single Connect-account trigger with
          the og sidebar's Main Account image. */}
      {isHydrated && !isSignedIn ? (
        <div className="flex w-full shrink-0 items-center">
          <button
            className="t-hover flex h-[60px] items-center rounded-2xl px-4 text-left hover:bg-accent"
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
        </div>
      ) : (
        <div className="relative flex w-full shrink-0 items-center">
          <button
            className="t-hover flex h-[60px] items-center rounded-2xl px-4 text-left hover:bg-accent"
            onClick={() => {
              if (cherryRuntime.mode === "standalone") {
                setIsWalletMenuOpen((open) => !open);
              }
            }}
            type="button"
          >
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
              {/* transitions.dev icon swap: copy ↔ check while isCopied. */}
              <span
                className="t-icon-swap size-6 shrink-0 cursor-pointer"
                data-state={isCopied ? "b" : "a"}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCopyAddress();
                }}
              >
                <span
                  className="t-icon icon-themed size-6 text-tertiary"
                  data-icon="a"
                  role="img"
                  aria-label="Copy address"
                  style={
                    {
                      "--icon": `url("${ASSET_BASE}/icon-copy.svg")`,
                    } as CSSProperties
                  }
                />
                <span
                  aria-hidden="true"
                  className="t-icon icon-themed size-6 text-tertiary"
                  data-icon="b"
                  style={
                    {
                      "--icon": `url("${ASSET_BASE}/icon-check.svg")`,
                    } as CSSProperties
                  }
                />
              </span>
            </span>
            {cherryRuntime.mode === "standalone" ? (
              <ThemedIcon
                className="ml-2 size-6 text-tertiary"
                src={`${ASSET_BASE}/icon-chevron-down.svg`}
              />
            ) : null}
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end pl-3">
            <button
              aria-label="Receive"
              className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
              onClick={() => setIsReceiveOpen(true)}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-tertiary"
                src={`${ASSET_BASE}/icon-qr.svg`}
              />
            </button>
            <button
              aria-label={
                isDark ? "Switch to light theme" : "Switch to dark theme"
              }
              className="t-hover flex size-11 items-center justify-center rounded-3xl text-tertiary hover:bg-accent"
              onClick={(event) => {
                // Wipe from the toggle itself (also right for keyboard
                // activation, where click coords are unreliable).
                const rect = event.currentTarget.getBoundingClientRect();
                toggleTheme({
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                });
              }}
              type="button"
            >
              {isDark ? (
                <Sun className="size-6" />
              ) : (
                <Moon className="size-6" />
              )}
            </button>
          </div>

          {cherryRuntime.mode === "standalone" && isWalletMenuOpen ? (
            <button
              aria-label="Close wallet menu"
              className="fixed inset-0 z-20 cursor-default"
              onClick={() => setIsWalletMenuOpen(false)}
              type="button"
            />
          ) : null}
          {/* Same frosted sheet treatment as the withdraw source select. */}
          <DropdownReveal
            className="absolute bottom-[calc(100%+4px)] left-0 z-30 flex w-60 flex-col rounded-2xl bg-popover/70 p-2 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] backdrop-blur-[16px]"
            isOpen={cherryRuntime.mode === "standalone" && isWalletMenuOpen}
            origin="bottom-left"
          >
            <button
              className="t-hover flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left font-medium text-[16px] text-foreground leading-5 enabled:hover:bg-accent disabled:text-tertiary"
              disabled={!canDisconnect}
              onClick={() => {
                setIsWalletMenuOpen(false);
                handleDisconnect();
              }}
              type="button"
            >
              <ThemedIcon
                className="size-5 text-tertiary"
                src={`${ASSET_BASE}/icon-logout.svg`}
              />
              Disconnect
            </button>
          </DropdownReveal>
          <ReceiveSheet
            isOpen={isReceiveOpen}
            onClose={() => setIsReceiveOpen(false)}
            walletAddress={data.walletAddress}
          />
        </div>
      )}
    </aside>
  );
}
