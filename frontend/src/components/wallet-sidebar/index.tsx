"use client";

import { ArrowDownLeft, ArrowUpRight, RefreshCw, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { WalletTab } from "@/components/auth/wallet-tab";
import { usePublicEnv } from "@/contexts/public-env-context";
import type { WalletDesktopData } from "@/hooks/use-wallet-desktop-data";
import {
  trackWalletShieldPressed,
  trackWalletSidebarTabOpen,
} from "@/lib/core/analytics";
import { getTokenIconUrl } from "@/lib/token-icon";

import { AllActivityView } from "./all-activity-view";
import { AllApprovalsView } from "./all-approvals-view";
import { AllTokensView } from "./all-tokens-view";
import { PortfolioContent } from "./portfolio-content";
import { ReceiveContent } from "./receive-content";
import { SendContent } from "./send-content";
import { ShieldContent, SwapShieldTabs } from "./shield-content";
import { SwapContent } from "./swap-content";
import { TokenSelectView } from "./token-select-view";
import { AccountPageView } from "./account-page-view";
import { AgentPageView } from "./agent-page-view";
import { ApprovalReviewContent } from "./approval-review-content";
import { VaultAccountPageView } from "./vault-account-page-view";
import { ConnectRequestContent } from "./connect-request-content";
import { TransactionDetailView } from "./transaction-detail-view";
import type {
  FormButtonProps,
  RightSidebarTab,
  SubView,
  SwapMode,
  SwapToken,
  TransactionDetail,
} from "./types";
import { LOYL_TOKEN, swapTokens as fallbackSwapTokens } from "./types";

export type { RightSidebarTab } from "./types";

export interface HeroRightSidebarProps {
  isOpen: boolean;
  activeTab: RightSidebarTab;
  onClose: () => void;
  onTabChange: (tab: RightSidebarTab) => void;
  isBalanceHidden: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  showQuickActions?: boolean;
  walletDesktopData: WalletDesktopData;
  onDisconnect?: () => void;
  connectAgentName?: string;
  onConnectDecline?: () => void;
  onConnectApprove?: () => void;
  hasVaultAccount?: boolean;
}

export function HeroRightSidebar(props: HeroRightSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(props.isOpen);
  const publicEnv = usePublicEnv();

  // Turnstile captcha gate for sign-in tab
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileMode = publicEnv.turnstile.mode;
  const needsCaptchaWidget = turnstileMode === "widget";

  // Auto-resolve captcha for bypass (local dev) and misconfigured environments
  useEffect(() => {
    if (!needsCaptchaWidget && captchaToken === null) {
      setCaptchaToken(
        turnstileMode === "bypass"
          ? (publicEnv.turnstile as { mode: "bypass"; verificationToken: string }).verificationToken
          : "captcha-skipped"
      );
    }
  }, [captchaToken, needsCaptchaWidget, publicEnv.turnstile, turnstileMode]);

  // Reset captcha when sidebar closes
  useEffect(() => {
    if (!props.isOpen) {
      setCaptchaToken(null);
    }
  }, [props.isOpen]);

  // Trap wheel events inside the sidebar so page doesn't scroll
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Find the nearest scrollable ancestor within the sidebar
      let target = e.target as HTMLElement | null;
      while (target && target !== el) {
        const { overflowY } = getComputedStyle(target);
        if (overflowY === "auto" || overflowY === "scroll") {
          const atTop = target.scrollTop <= 0 && e.deltaY < 0;
          const atBottom =
            target.scrollTop + target.clientHeight >= target.scrollHeight - 1 &&
            e.deltaY > 0;
          if (!atTop && !atBottom) return; // let inner element scroll normally
        }
        target = target.parentElement;
      }
      e.preventDefault();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Navigation stack: stack[0] = Layer 1, stack[1] = Layer 2
  const [viewStack, setViewStack] = useState<Exclude<SubView, null>[]>([]);
  const pushView = useCallback((view: Exclude<SubView, null>) => {
    setViewStack((s) => [...s, view]);
  }, []);
  const popView = useCallback(() => {
    setViewStack((s) => s.slice(0, -1));
  }, []);
  const resetViews = useCallback(() => {
    setViewStack([]);
  }, []);

  // Derived: what's at each layer
  const level1View: SubView = viewStack[0] ?? null;
  const level2View: SubView = viewStack[1] ?? null;
  const level3View: SubView = viewStack[2] ?? null;

  // Delayed copies for exit animations
  const [displayLevel1, setDisplayLevel1] = useState<SubView>(null);
  const [displayLevel2, setDisplayLevel2] = useState<SubView>(null);
  const [displayLevel3, setDisplayLevel3] = useState<SubView>(null);
  useEffect(() => {
    if (level1View) {
      setDisplayLevel1(level1View);
    } else {
      const t = setTimeout(() => setDisplayLevel1(null), 350);
      return () => clearTimeout(t);
    }
  }, [level1View]);
  useEffect(() => {
    if (level2View) {
      setDisplayLevel2(level2View);
    } else {
      const t = setTimeout(() => setDisplayLevel2(null), 350);
      return () => clearTimeout(t);
    }
  }, [level2View]);
  useEffect(() => {
    if (level3View) {
      setDisplayLevel3(level3View);
    } else {
      const t = setTimeout(() => setDisplayLevel3(null), 350);
      return () => clearTimeout(t);
    }
  }, [level3View]);

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Derive real token list from wallet positions, falling back to mock data
  const derivedTokens = useMemo<SwapToken[]>(() => {
    const positions = props.walletDesktopData.positions;
    if (!positions || positions.length === 0) return fallbackSwapTokens;

    const tokens: SwapToken[] = positions
      .filter((p) => p.totalBalance > 0 || ["SOL", "USDC"].includes(p.asset.symbol))
      .map((p) => ({
        mint: p.asset.mint,
        symbol: p.asset.symbol,
        icon: getTokenIconUrl(p.asset.symbol),
        price: p.priceUsd ?? 0,
        balance: p.totalBalance,
      }));

    // Inject LOYL at 3rd position if not already present
    if (!tokens.some((t) => t.mint === LOYL_TOKEN.mint)) {
      const loylPosition = positions.find((p) => p.asset.mint === LOYL_TOKEN.mint);
      const loyl = loylPosition
        ? { ...LOYL_TOKEN, price: loylPosition.priceUsd ?? 0, balance: loylPosition.totalBalance }
        : LOYL_TOKEN;
      tokens.splice(2, 0, loyl as SwapToken);
    }

    return tokens;
  }, [props.walletDesktopData.positions]);

  // Cross-fade when switching tabs: fade out → swap content → fade in
  const [crossFadeOpacity, setCrossFadeOpacity] = useState(1);
  const [displayTab, setDisplayTab] = useState(props.activeTab);
  useEffect(() => {
    const justOpened = props.isOpen && !wasOpenRef.current;
    wasOpenRef.current = props.isOpen;

    if (props.activeTab !== displayTab) {
      // Swap instantly when sidebar is closed, just opening, or transitioning to/from sign-in
      if (!props.isOpen || justOpened || props.activeTab === "sign-in" || displayTab === "sign-in" || props.activeTab === "connect" || displayTab === "connect") {
        setDisplayTab(props.activeTab);
        setCrossFadeOpacity(1);
        return;
      }
      setCrossFadeOpacity(0); // fade out
      const t = setTimeout(() => {
        setDisplayTab(props.activeTab); // swap content while near-invisible
        setCrossFadeOpacity(1); // fade in
      }, 200);
      return () => clearTimeout(t);
    }
  }, [props.activeTab, displayTab, props.isOpen]);

  // Reset confirmation when leaving portfolio tab
  useEffect(() => {
    if (displayTab !== "portfolio") setShowDisconnectConfirm(false);
  }, [displayTab]);

  // Swap token state (lifted here so token selection sub-view can update it)
  const [swapFromToken, setSwapFromToken] = useState<SwapToken>(derivedTokens[0] ?? fallbackSwapTokens[0]);
  const [swapToToken, setSwapToToken] = useState<SwapToken>(LOYL_TOKEN);

  // Swap/Shield mode
  const [swapMode, setSwapMode] = useState<SwapMode>("swap");
  const [swapFormActive, setSwapFormActive] = useState(true);
  const [shieldFormActive, setShieldFormActive] = useState(true);
  const showSharedTabs = swapMode === "swap" ? swapFormActive : shieldFormActive;
  const [swapButtonProps, setSwapButtonProps] = useState<FormButtonProps | null>(null);
  const [shieldButtonProps, setShieldButtonProps] = useState<FormButtonProps | null>(null);
  const activeButtonProps = swapMode === "swap" ? swapButtonProps : shieldButtonProps;

  // Shield token state
  const [shieldToken, setShieldToken] = useState<SwapToken>(derivedTokens[0] ?? fallbackSwapTokens[0]);

  // Derived secured balance for the selected shield token
  const shieldSecuredBalance = useMemo(() => {
    if (!shieldToken.mint) return 0;
    const position = props.walletDesktopData.positions.find((p) => p.asset.mint === shieldToken.mint);
    return position?.securedBalance ?? 0;
  }, [shieldToken.mint, props.walletDesktopData.positions]);

  // Send token state
  const [sendToken, setSendToken] = useState<SwapToken>(derivedTokens[0] ?? fallbackSwapTokens[0]);

  const handleQuickActionTabClick = useCallback(
    (tab: "portfolio" | "receive" | "send" | "swap") => {
      if (props.activeTab !== tab) {
        trackWalletSidebarTabOpen(publicEnv, {
          source: "sidebar_quick_action",
          tab,
        });
      }

      props.onTabChange(tab);
    },
    [props.activeTab, props.onTabChange, publicEnv]
  );

  const handleSwapModeChange = useCallback(
    (mode: SwapMode) => {
      if (swapMode !== mode && mode === "shield") {
        trackWalletShieldPressed(publicEnv, {
          source: "swap_sidebar_tab",
          interaction: "open",
        });
      }

      setSwapMode(mode);
    },
    [publicEnv, swapMode]
  );

  // Update tokens when derived tokens change (wallet connects/disconnects)
  useEffect(() => {
    if (derivedTokens.length > 0 && derivedTokens[0].mint) {
      setSwapFromToken(derivedTokens[0]);
      setSwapToToken(derivedTokens.find((t) => t.mint === LOYL_TOKEN.mint) ?? LOYL_TOKEN);
      setSendToken(derivedTokens[0]);
      setShieldToken(derivedTokens[0]);
    }
  }, [derivedTokens]);

  // Derived state
  const hasLevel1 = viewStack.length >= 1;
  const hasLevel2 = viewStack.length >= 2;
  const hasLevel3 = viewStack.length >= 3;

  // Helper to check view type
  const viewType = (v: SubView) => (typeof v === "object" && v !== null ? v.type : v);

  // Reset everything when sidebar closes
  useEffect(() => {
    if (!props.isOpen) {
      const t = setTimeout(() => {
        setViewStack([]);
        setDisplayLevel1(null);
        setDisplayLevel2(null);
        setDisplayLevel3(null);
      }, 350);
      return () => clearTimeout(t);
    }
  }, [props.isOpen]);

  const handleTokenSelect = useCallback(
    (token: SwapToken) => {
      const topView = viewStack[viewStack.length - 1];
      if (typeof topView === "object" && topView?.type === "tokenSelect") {
        if (topView.field === "from") {
          if (token.symbol === swapToToken.symbol) {
            setSwapToToken(swapFromToken);
          }
          setSwapFromToken(token);
        } else {
          if (token.symbol === swapFromToken.symbol) {
            setSwapFromToken(swapToToken);
          }
          setSwapToToken(token);
        }
      }
    },
    [viewStack, swapFromToken, swapToToken],
  );

  // Render any sub-view by type. Used for both Layer 1 and Layer 2.
  const renderSubView = (view: SubView, onBack: () => void) => {
    if (!view) return null;
    const type = viewType(view);

    if (view === "allTokens") {
      return (
        <AllTokensView
          isBalanceHidden={props.isBalanceHidden}
          onBack={onBack}
          onClose={props.onClose}
          tokens={props.walletDesktopData.allTokenRows}
        />
      );
    }
    if (view === "allActivity") {
      return (
        <AllActivityView
          activities={props.walletDesktopData.allActivityRows}
          details={props.walletDesktopData.transactionDetails}
          isBalanceHidden={props.isBalanceHidden}
          onBack={onBack}
          onClose={props.onClose}
          onNavigate={pushView}
        />
      );
    }
    if (view === "allApprovals") {
      return (
        <AllApprovalsView
          isBalanceHidden={props.isBalanceHidden}
          onBack={onBack}
          onClose={props.onClose}
          onReview={() => pushView({ type: "approvalReview" })}
        />
      );
    }
    if (type === "transaction") {
      const detail = (view as { type: "transaction"; detail: TransactionDetail; from: string }).detail;
      return (
        <TransactionDetailView
          detail={detail}
          onBack={onBack}
          onClose={props.onClose}
        />
      );
    }
    if (type === "tokenSelect") {
      const field = (view as { type: "tokenSelect"; field: "from" | "to" }).field;
      return (
        <TokenSelectView
          currentToken={field === "from" ? swapFromToken : swapToToken}
          onBack={onBack}
          onClose={props.onClose}
          onSelect={handleTokenSelect}
          title={field === "from" ? "You Swap" : "You Receive"}
          tokens={derivedTokens}
        />
      );
    }
    if (type === "sendTokenSelect") {
      return (
        <TokenSelectView
          currentToken={sendToken}
          onBack={onBack}
          onClose={props.onClose}
          onSelect={(token) => setSendToken(token)}
          title="Send"
          tokens={derivedTokens}
        />
      );
    }
    if (type === "shieldTokenSelect") {
      return (
        <TokenSelectView
          currentToken={shieldToken}
          onBack={onBack}
          onClose={props.onClose}
          onSelect={(token) => {
            setShieldToken(token);
            popView();
          }}
          title="Shield"
          tokens={derivedTokens}
        />
      );
    }
    if (type === "approvalReview") {
      return (
        <ApprovalReviewContent
          onBack={onBack}
          onClose={props.onClose}
          onDecline={onBack}
          onApprove={() => {
            resetViews();
            props.onConnectApprove?.();
          }}
        />
      );
    }
    if (type === "accountPage") {
      const account = (view as { type: "accountPage"; account: "main" | "vault" }).account;
      if (account === "vault") {
        return (
          <VaultAccountPageView
            balanceWhole="$7,000"
            balanceFraction=".00"
            isBalanceHidden={props.isBalanceHidden}
            onBalanceHiddenChange={props.onBalanceHiddenChange}
            tokenRows={props.walletDesktopData.tokenRows}
            activityRows={props.walletDesktopData.activityRows}
            transactionDetails={props.walletDesktopData.transactionDetails}
            onBack={onBack}
            onClose={props.onClose}
            onNavigate={pushView}
          />
        );
      }
      return (
        <AccountPageView
          accountLabel="Main"
          accountIcon="/purplebg.png"
          balanceWhole={props.walletDesktopData.balanceWhole}
          balanceFraction={props.walletDesktopData.balanceFraction}
          isBalanceHidden={props.isBalanceHidden}
          onBalanceHiddenChange={props.onBalanceHiddenChange}
          tokenRows={props.walletDesktopData.tokenRows}
          activityRows={props.walletDesktopData.activityRows}
          transactionDetails={props.walletDesktopData.transactionDetails}
          onBack={onBack}
          onClose={props.onClose}
          onNavigate={pushView}
          onTabChange={props.onTabChange}
        />
      );
    }
    if (type === "agentPage") {
      const agent = view as { type: "agentPage"; agentId: string; label: string; initials: string; balanceWhole: string; balanceFraction: string };
      return (
        <AgentPageView
          label={agent.label}
          initials={agent.initials}
          balanceWhole={agent.balanceWhole}
          balanceFraction={agent.balanceFraction}
          isBalanceHidden={props.isBalanceHidden}
          onBalanceHiddenChange={props.onBalanceHiddenChange}
          onBack={onBack}
          onClose={props.onClose}
        />
      );
    }
    return null;
  };

  return (
    <>
      <style jsx>{`
        .right-sidebar-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .show-all-btn:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .quick-action-btn:hover {
          background: rgba(0, 0, 0, 0.06) !important;
        }
        .disconnect-confirm-btn:hover {
          background: rgba(255, 59, 48, 0.2) !important;
        }
        .disconnect-cancel-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        @keyframes sidebar-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        ref={sidebarRef}
        style={{
          position: "fixed",
          top: "8px",
          right: "8px",
          bottom: "8px",
          zIndex: 110,
          pointerEvents: props.isOpen ? "auto" : "none",
        }}
      >
        <div
          style={{
            width: "min(398px, calc(100vw - 16px))",
            height: "100%",
            position: "relative",
            transform: props.isOpen ? "translateX(0)" : "translateX(110%)",
            opacity: props.isOpen ? 1 : 0,
            transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {/* Layer 0: Main panel */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: hasLevel1 ? "#F5F5F5" : "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              borderRadius: "20px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transform: hasLevel1 ? "translateX(-6px)" : "translateX(0)",
              transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: hasLevel1 ? "none" : "auto",
            }}
          >
            {/* Quick action buttons — shown when hero cards are not visible, hidden on sign-in tab */}
            <div
              style={{
                display: "flex",
                gap: "6px",
                padding: props.showQuickActions && displayTab !== "sign-in" && displayTab !== "connect" ? "8px 8px 0" : "0 8px",
                maxHeight: props.showQuickActions && displayTab !== "sign-in" && displayTab !== "connect" ? "52px" : "0",
                opacity: props.showQuickActions && displayTab !== "sign-in" && displayTab !== "connect" ? 1 : 0,
                overflow: "hidden",
                transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              {(["portfolio", "receive", "send", "swap"] as const).map((tab) => (
                <button
                  className="quick-action-btn"
                  key={tab}
                  onClick={() => handleQuickActionTabClick(tab)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "8px 0",
                    border: "none",
                    borderRadius: "12px",
                    cursor: "pointer",
                    background: props.activeTab === tab ? "rgba(0, 0, 0, 0.06)" : "rgba(0, 0, 0, 0.02)",
                    transition: "background 0.2s ease",
                  }}
                >
                  {tab === "portfolio" && <Wallet size={16} style={{ color: "#F9363C" }} />}
                  {tab === "receive" && <ArrowDownLeft size={16} style={{ color: "#F9363C" }} />}
                  {tab === "send" && <ArrowUpRight size={16} style={{ color: "#F9363C" }} />}
                  {tab === "swap" && <RefreshCw size={16} style={{ color: "#F9363C" }} />}
                  <span style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "13px", fontWeight: 500, lineHeight: "16px", color: "#000" }}>
                    {tab === "portfolio" ? "Wallet" : tab === "receive" ? "Receive" : tab === "send" ? "Send" : "Swap"}
                  </span>
                </button>
              ))}
            </div>

            {/* Disconnect confirmation bar — slides in like quick action buttons */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: showDisconnectConfirm ? "8px 12px" : "0 12px",
                maxHeight: showDisconnectConfirm ? "80px" : "0",
                opacity: showDisconnectConfirm ? 1 : 0,
                overflow: "hidden",
                transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "13px",
                  fontWeight: 500,
                  lineHeight: "16px",
                  color: "rgba(60, 60, 67, 0.6)",
                  textAlign: "center",
                }}
              >
                Disconnect wallet?
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="disconnect-confirm-btn"
                  onClick={() => {
                    setShowDisconnectConfirm(false);
                    props.onDisconnect?.();
                  }}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    border: "none",
                    borderRadius: "10px",
                    cursor: "pointer",
                    background: "rgba(255, 59, 48, 0.12)",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: "16px",
                    color: "#FF3B30",
                    transition: "background 0.15s ease",
                  }}
                  type="button"
                >
                  Yes
                </button>
                <button
                  className="disconnect-cancel-btn"
                  onClick={() => setShowDisconnectConfirm(false)}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    border: "none",
                    borderRadius: "10px",
                    cursor: "pointer",
                    background: "rgba(0, 0, 0, 0.04)",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: "16px",
                    color: "#000",
                    transition: "background 0.15s ease",
                  }}
                  type="button"
                >
                  Nevermind
                </button>
              </div>
            </div>

            {/* Content wrapper for cross-fade (bg stays solid) */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                opacity: crossFadeOpacity,
                transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              {displayTab === "portfolio" && (
                <PortfolioContent
                  balanceFraction={props.walletDesktopData.balanceFraction}
                  balanceWhole={props.walletDesktopData.balanceWhole}
                  isBalanceHidden={props.isBalanceHidden}
                  isLoading={props.walletDesktopData.isLoading}
                  onBalanceHiddenChange={props.onBalanceHiddenChange}
                  onClose={props.onClose}
                  onDisconnect={() => setShowDisconnectConfirm(true)}
                  onTabChange={props.onTabChange}
                  hasVaultAccount={props.hasVaultAccount ?? false}
                  onReviewApproval={() => pushView({ type: "approvalReview" })}
                  onSeeAllApprovals={() => pushView("allApprovals")}
                  onOpenAccount={(account) => pushView({ type: "accountPage", account })}
                  walletAddress={props.walletDesktopData.walletAddress}
                  walletLabel={props.walletDesktopData.walletLabel}
                />
              )}
              {displayTab === "receive" && (
                <ReceiveContent
                  onClose={props.onClose}
                  walletAddress={props.walletDesktopData.walletAddress}
                />
              )}
              {displayTab === "send" && (
                <SendContent
                  addLocalActivity={props.walletDesktopData.addLocalActivity}
                  onClose={props.onClose}
                  onDone={() => props.onTabChange("portfolio")}
                  onNavigate={pushView}
                  token={sendToken}
                />
              )}
              {displayTab === "swap" && (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                  {/* Shared tab bar — stays fixed, hidden when non-form phase takes over */}
                  {showSharedTabs && (
                    <SwapShieldTabs mode={swapMode} onClose={props.onClose} onModeChange={handleSwapModeChange} />
                  )}

                  {/* Sliding content area */}
                  <div
                    style={{
                      position: "relative",
                      flex: 1,
                      minHeight: 0,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        transform: swapMode === "swap" ? "translateX(0)" : "translateX(-100%)",
                        transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
                        willChange: "transform",
                      }}
                    >
                      <SwapContent
                        fromToken={swapFromToken}
                        hideFormChrome
                        onClose={props.onClose}
                        onDone={() => props.onTabChange("portfolio")}
                        onFormActiveChange={setSwapFormActive}
                        onFormButtonChange={setSwapButtonProps}
                        onFromTokenChange={setSwapFromToken}
                        onNavigate={pushView}
                        onSwapModeChange={handleSwapModeChange}
                        onToTokenChange={setSwapToToken}
                        swapMode={swapMode}
                        toToken={swapToToken}
                      />
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        transform: swapMode === "shield" ? "translateX(0)" : "translateX(100%)",
                        transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
                        willChange: "transform",
                      }}
                    >
                      <ShieldContent
                        hideFormChrome
                        onClose={props.onClose}
                        onDone={() => props.onTabChange("portfolio")}
                        onFormActiveChange={setShieldFormActive}
                        onFormButtonChange={setShieldButtonProps}
                        onNavigate={pushView}
                        onSwapModeChange={handleSwapModeChange}
                        onTokenChange={setShieldToken}
                        securedBalance={shieldSecuredBalance}
                        swapMode={swapMode}
                        token={shieldToken}
                      />
                    </div>
                  </div>

                  {/* Shared bottom button — stays fixed */}
                  {activeButtonProps && (
                    <div style={{ padding: "16px 20px" }}>
                      <button
                        disabled={activeButtonProps.disabled}
                        onClick={activeButtonProps.onClick}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          borderRadius: "9999px",
                          background: activeButtonProps.disabled ? "#CCCDCD" : "#000",
                          border: "none",
                          cursor: activeButtonProps.disabled ? "default" : "pointer",
                          fontFamily: "var(--font-geist-sans), sans-serif",
                          fontSize: "16px",
                          fontWeight: 400,
                          lineHeight: "20px",
                          color: "#fff",
                          textAlign: "center",
                          transition: "background 0.15s ease",
                        }}
                        type="button"
                      >
                        {activeButtonProps.label}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {displayTab === "sign-in" && (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "16px 20px 8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: "18px",
                        fontWeight: 600,
                        lineHeight: "24px",
                        color: "#000",
                      }}
                    >
                      Sign In
                    </span>
                    <button
                      className="right-sidebar-close"
                      onClick={props.onClose}
                      style={{
                        width: "36px",
                        height: "36px",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        background: "rgba(0, 0, 0, 0.04)",
                        border: "none",
                        borderRadius: "9999px",
                        cursor: "pointer",
                        transition: "background 0.2s ease",
                        color: "#3C3C43",
                      }}
                    >
                      <X size={24} />
                    </button>
                  </div>
                  <div style={{ padding: "8px 20px", flex: 1 }}>
                    {captchaToken === null ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", paddingTop: "16px" }}>
                        <p
                          style={{
                            fontFamily: "var(--font-geist-sans), sans-serif",
                            fontSize: "14px",
                            lineHeight: "20px",
                            color: "rgba(60, 60, 67, 0.6)",
                          }}
                        >
                          Complete verification to continue
                        </p>
                        <TurnstileWidget onVerify={setCaptchaToken} />
                      </div>
                    ) : (
                      <>
                        <p
                          style={{
                            fontFamily: "var(--font-geist-sans), sans-serif",
                            fontSize: "14px",
                            lineHeight: "20px",
                            color: "rgba(60, 60, 67, 0.6)",
                            marginBottom: "8px",
                          }}
                        >
                          Connect your wallet to get started.
                        </p>
                        {props.walletDesktopData.isConnected ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "24px 0" }}>
                            <div style={{ width: "24px", height: "24px", border: "2px solid rgba(0,0,0,0.1)", borderTopColor: "#3C3C43", borderRadius: "9999px", animation: "sidebar-spin 0.8s linear infinite" }} />
                          </div>
                        ) : (
                          <WalletTab />
                        )}
                        {/* TODO: Re-enable email and passkey auth */}
                        {/* <Divider /> */}
                        {/* <EmailTab captchaToken={captchaToken} onFlowStart={() => {}} /> */}
                        {/* <Divider /> */}
                        {/* <PasskeyTab onFlowStart={() => {}} /> */}
                      </>
                    )}
                  </div>
                </div>
              )}
              {displayTab === "connect" && (
                <ConnectRequestContent
                  agentName={props.connectAgentName ?? "Unknown"}
                  onClose={props.onClose}
                  onDecline={props.onConnectDecline ?? props.onClose}
                  onApprove={props.onConnectApprove ?? props.onClose}
                />
              )}
            </div>
          </div>

          {/* Layer 1: Sub-views (allTokens / allActivity / tokenSelect) */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: hasLevel2 ? "#F5F5F5" : "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              borderRadius: "20px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transform: hasLevel1
                ? hasLevel2
                  ? "translateX(-6px)"
                  : "translateX(0)"
                : "translateX(105%)",
              opacity: hasLevel1 ? 1 : 0,
              transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: hasLevel1 && !hasLevel2 ? "auto" : "none",
            }}
          >
            {renderSubView(displayLevel1, popView)}
          </div>

          {/* Layer 2 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: hasLevel3 ? "#F5F5F5" : "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              borderRadius: "20px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transform: hasLevel2
                ? hasLevel3
                  ? "translateX(-6px)"
                  : "translateX(0)"
                : "translateX(105%)",
              opacity: hasLevel2 ? 1 : 0,
              transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: hasLevel2 && !hasLevel3 ? "auto" : "none",
            }}
          >
            {renderSubView(displayLevel2, popView)}
          </div>

          {/* Layer 3 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#FFFFFF",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              borderRadius: "20px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transform: hasLevel3 ? "translateX(0)" : "translateX(105%)",
              opacity: hasLevel3 ? 1 : 0,
              transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: hasLevel3 ? "auto" : "none",
            }}
          >
            {renderSubView(displayLevel3, popView)}
          </div>
        </div>
      </div>
    </>
  );
}
