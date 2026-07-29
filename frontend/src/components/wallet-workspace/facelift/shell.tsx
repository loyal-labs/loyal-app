"use client";

import { useEffect, useRef, useState } from "react";

import { WalletReconnectPrompt } from "@/components/auth/wallet-reconnect-prompt";
import { ActivityPage } from "@/components/wallet-workspace/facelift/activity-page";
import { AutodepositPane } from "@/components/wallet-workspace/facelift/autodeposit-pane";
import {
  BalanceVisibilityProvider,
  HiddenBalanceFilterDefs,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { CryptoPage } from "@/components/wallet-workspace/facelift/crypto-page";
import { DepositPane } from "@/components/wallet-workspace/facelift/deposit-pane";
import { EarnApprovalSheet } from "@/components/wallet-workspace/facelift/earn-approval-sheet";
import {
  EarnChartPane,
  type ChartTab,
} from "@/components/wallet-workspace/facelift/earn-chart-pane";
import { startEarnEarningsPrefetch } from "@/components/wallet-workspace/facelift/earn-earnings-prefetch";
import { EarnEmptyPane } from "@/components/wallet-workspace/facelift/earn-empty-pane";
import { EarnStatsPanel } from "@/components/wallet-workspace/facelift/earn-stats-panel";
import { EarnPositionPane } from "@/components/wallet-workspace/facelift/earn-position-pane";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import {
  MiddlePaneSlide,
  PaneReveal,
} from "@/components/wallet-workspace/facelift/pane-transitions";
import {
  isEscapeGuardedTarget,
  isTypingTarget,
} from "@/components/wallet-workspace/facelift/keyboard";
import { FaceliftSidebar } from "@/components/wallet-workspace/facelift/sidebar";
import { useEarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { WalletHomePage } from "@/components/wallet-workspace/facelift/wallet-home-page";
import { WithdrawPane } from "@/components/wallet-workspace/facelift/withdraw-pane";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useAuthCapability } from "@/lib/auth/capability";

// "wallet" is the mobile-only wallet home (the tab bar's Wallet tab); the
// sidebar navigates straight to crypto/stables instead.
export type WorkspacePage =
  | "crypto"
  | "stables"
  | "activity"
  | "earn"
  | "wallet";

type MiddleView = "earn" | "deposit" | "withdraw" | "autodeposit";

const PAGE_STORAGE_KEY = "loyal:workspace-page";
const WORKSPACE_PAGES: WorkspacePage[] = [
  "crypto",
  "stables",
  "activity",
  "earn",
  "wallet",
];

// Desktop section shortcuts — surfaced as the sidebar's hover kbd hints.
const SHORTCUT_PAGES: Partial<Record<string, WorkspacePage>> = {
  a: "activity",
  c: "crypto",
  e: "earn",
  s: "stables",
};

// Figma 4693:64818 — fixed 3-pane workspace: 360px sidebar on the gray shell,
// fluid middle panel, 400px right panel. Panes are intentionally not resizable.
// Below 1204px the right pane would force the dog under its 420px natural size,
// so it hides (Figma 4693:65423) and the middle header shows a chart button
// that opens the expanded chart overlay instead. Below 796px the sidebar goes
// too: screens run full-bleed with a bottom tab bar (Figma 4693:69948 et al.),
// and only the Earn screen with a position keeps the gray card background
// (Figma 4693:70364).
export function WorkspaceFaceliftShell() {
  const publicEnv = usePublicEnv();
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  // One shared tab choice for every chart card (compact right pane, mobile
  // inline card, enlarged overlay) — enlarging must not reset the tab.
  const [chartTab, setChartTab] = useState<ChartTab | null>(null);
  const [activePage, setActivePage] = useState<WorkspacePage>("earn");
  const { isHydrated, isSignedIn } = useAuthCapability();
  const { open: openSignIn } = useSignInModal();
  // Reload lands on the last visited page — signed-in only; a disconnected
  // wallet always lands on Earn. Restored in an effect (not the initializer)
  // so the client's first render matches the server HTML, and only after auth
  // hydration (the pre-hydration render is the quiet white pane anyway). The
  // once-ref keeps a later sign-in from yanking the user back to the stored
  // page mid-session.
  const hasRestoredPageRef = useRef(false);
  useEffect(() => {
    if (!isHydrated || hasRestoredPageRef.current) {
      return;
    }
    hasRestoredPageRef.current = true;
    if (!isSignedIn) {
      return;
    }
    const stored = localStorage.getItem(PAGE_STORAGE_KEY) as WorkspacePage;
    if (WORKSPACE_PAGES.includes(stored) && stored !== "earn") {
      setActivePage(stored);
    }
  }, [isHydrated, isSignedIn]);
  useEffect(() => {
    localStorage.setItem(PAGE_STORAGE_KEY, activePage);
  }, [activePage]);
  // Signing out mid-session snaps back to Earn — the only page that works
  // without a wallet (its empty pane carries the Connect wallet CTA).
  useEffect(() => {
    if (isHydrated && !isSignedIn && activePage !== "earn") {
      setActivePage("earn");
    }
  }, [activePage, isHydrated, isSignedIn]);
  const [middleView, setMiddleView] = useState<MiddleView>("earn");
  // Set when a positions-tab row's Withdraw pill opened the screen — the
  // withdraw pane preselects that source; header Withdraw clears it.
  const [withdrawSourceKey, setWithdrawSourceKey] = useState<string | null>(
    null
  );
  // Mirrored from the sidebar (which owns the unseen-activity computation)
  // so the mobile tab bar's clock shows the same badge.
  const [hasUnseenActivity, setHasUnseenActivity] = useState(false);
  const earnData = useEarnPositionData();
  // Bumped on every sidebar selection so CryptoPage abandons its in-progress
  // Send/Swap/Shield screens — including re-selecting the page it's already on.
  const [navigationNonce, setNavigationNonce] = useState(0);
  useEffect(() => {
    const walletAddress = earnData.walletAddress;
    const settingsPda = earnData.settingsPda;
    if (!(walletAddress && settingsPda)) {
      return;
    }

    startEarnEarningsPrefetch({
      enabled:
        isHydrated &&
        isSignedIn &&
        earnData.hasResolvedPosition &&
        earnData.hasPosition &&
        earnData.earnBalanceUsd > 0,
      revalidationKey: earnData.position?.principalAmountRaw ?? "0",
      settingsPda,
      solanaEnv: publicEnv.solanaEnv,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      walletAddress,
    });
  }, [
    earnData.earnBalanceUsd,
    earnData.hasPosition,
    earnData.hasResolvedPosition,
    earnData.position?.principalAmountRaw,
    earnData.settingsPda,
    earnData.walletAddress,
    isHydrated,
    isSignedIn,
    publicEnv.solanaEnv,
  ]);
  const handleSelectPage = (page: WorkspacePage) => {
    // Disconnected wallets live on Earn — every other page needs a session,
    // so tapping one opens the connect-wallet modal instead of navigating.
    if (!isSignedIn && page !== "earn") {
      openSignIn();
      return;
    }
    setActivePage(page);
    // Leaving Earn abandons any in-progress action screen.
    setMiddleView("earn");
    setNavigationNonce((nonce) => nonce + 1);
  };
  // Briefly lights the pressed key's sidebar hint red as activation feedback.
  const [flashedShortcut, setFlashedShortcut] = useState<WorkspacePage | null>(
    null
  );
  const flashTimerRef = useRef<number | null>(null);
  // Desktop keyboard nav: e/a/c/s jump to sections, Esc backs out of Earn's
  // action screens (CryptoPage owns Esc for Send/Swap/Shield). Skipped while
  // an input is focused so typing never navigates. Overlays own Esc first:
  // their handlers preventDefault, checked after dispatch via a microtask.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !window.matchMedia("(min-width: 796px)").matches
      ) {
        return;
      }
      if (event.key === "Escape") {
        // Numbers-only amount fields don't swallow Esc — only free text does.
        if (isEscapeGuardedTarget(event.target)) {
          return;
        }
        if (
          activePage === "earn" &&
          activeMiddleView !== "earn" &&
          !earnData.actions.pendingApproval &&
          !earnData.actions.isReconnectPromptOpen
        ) {
          queueMicrotask(() => {
            if (!event.defaultPrevented) {
              setMiddleView("earn");
            }
          });
        }
        return;
      }
      if (!isSignedIn || isTypingTarget(event.target)) {
        return;
      }
      const page = SHORTCUT_PAGES[event.key.toLowerCase()];
      if (!page) {
        return;
      }
      handleSelectPage(page);
      setFlashedShortcut(page);
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(
        () => setFlashedShortcut(null),
        800
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });
  // Deposit requires a session; fall back to the Earn state on sign-out.
  const activeMiddleView: MiddleView = isSignedIn ? middleView : "earn";
  // Avoid flashing the zero-state headline on reload: loading covers auth
  // hydration, the smart-account overview fetch (settingsPda === undefined —
  // hasResolvedPosition reads true while the position fetch is disabled, so
  // it can't be trusted before the overview lands), and the position fetch
  // itself. A quiet white pane stands in; the real pane panel-reveals in.
  const isPositionLoading =
    !isHydrated ||
    (isSignedIn &&
      (earnData.settingsPda === undefined || !earnData.hasResolvedPosition));
  const isEarnRootView = activeMiddleView === "earn";
  const isMobileGrayBackground =
    activePage === "earn" &&
    isEarnRootView &&
    earnData.hasPosition &&
    !isPositionLoading;

  return (
    <BalanceVisibilityProvider>
      {/* facelift-shell marks the workspace for globals.css's sign-in modal
          optical centering (the shell's side rails are asymmetric). */}
      <div className="facelift-shell flex h-dvh w-full overflow-clip bg-[#f5f5f5] text-black">
        <HiddenBalanceFilterDefs />
        {/* Wrong-wallet guard for Earn actions — same prompt the old
            workspace mounts (ensureCanSignAccountAction opens it). */}
        <WalletReconnectPrompt
          expectedWalletAddress={earnData.actions.authenticatedWalletAddress}
          onClose={earnData.actions.closeReconnectPrompt}
          onReady={earnData.actions.closeReconnectPrompt}
          open={earnData.actions.isReconnectPromptOpen}
        />
        {/* OG-style approval review for Earn deposit/withdraw/autodeposit —
            flows park between prepare and sign until the user responds. */}
        <EarnApprovalSheet approval={earnData.actions.pendingApproval} />
        <FaceliftSidebar
          activePage={activePage}
          earnBalanceUsd={earnData.earnBalanceUsd}
          flashedShortcut={flashedShortcut}
          isEarnBalanceLoading={isPositionLoading}
          onSelectPage={handleSelectPage}
          onUnseenActivityChange={setHasUnseenActivity}
        />
        <div
          className={`flex h-full min-w-0 flex-1 flex-col ${
            isMobileGrayBackground ? "" : "max-[795px]:bg-white"
          }`}
        >
          {activePage === "wallet" ? (
            <WalletHomePage
              earnBalanceUsd={earnData.earnBalanceUsd}
              isEarnBalanceLoading={isPositionLoading}
              onSelectPage={handleSelectPage}
              showActivityBadge={hasUnseenActivity}
            />
          ) : activePage === "activity" ? (
            <ActivityPage onSelectPage={handleSelectPage} />
          ) : activePage !== "earn" ? (
            <CryptoPage
              navigationNonce={navigationNonce}
              onBack={() => handleSelectPage("wallet")}
              onEarn={() => {
                // The stables Earn buttons jump straight to the deposit
                // screen, not the Earn root.
                setActivePage("earn");
                setMiddleView("deposit");
              }}
              page={activePage}
            />
          ) : (
            <>
              <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
                <MiddlePaneSlide
                  actionPane={
                    activeMiddleView === "withdraw" ? (
                      <WithdrawPane
                        data={earnData}
                        initialSourceKey={withdrawSourceKey}
                        onBack={() => setMiddleView("earn")}
                      />
                    ) : activeMiddleView === "autodeposit" ? (
                      <AutodepositPane
                        data={earnData}
                        onBack={() => setMiddleView("earn")}
                      />
                    ) : activeMiddleView === "deposit" ? (
                      <DepositPane
                        data={earnData}
                        onBack={() => setMiddleView("earn")}
                        onOpenChart={() => setIsChartExpanded(true)}
                      />
                    ) : null
                  }
                >
                  {isPositionLoading ? (
                    <section className="flex h-full min-w-0 flex-1 rounded-3xl bg-white max-[795px]:rounded-none" />
                  ) : earnData.hasPosition ? (
                    <PaneReveal>
                      <EarnPositionPane
                        data={earnData}
                        onDeposit={() => setMiddleView("deposit")}
                        onOpenAutodeposit={() => setMiddleView("autodeposit")}
                        onOpenChart={() => setIsChartExpanded(true)}
                        onSelectChartTab={setChartTab}
                        onWithdraw={(sourceKey) => {
                          setWithdrawSourceKey(sourceKey ?? null);
                          setMiddleView("withdraw");
                        }}
                        selectedChartTab={chartTab}
                      />
                    </PaneReveal>
                  ) : (
                    <PaneReveal>
                      <EarnEmptyPane
                        onDeposit={() => setMiddleView("deposit")}
                        onOpenChart={() => setIsChartExpanded(true)}
                      />
                    </PaneReveal>
                  )}
                </MiddlePaneSlide>
                {activeMiddleView === "withdraw" ||
                activeMiddleView === "autodeposit" ? null : (
                  <EarnChartPane
                    earnData={earnData}
                    hideAside={activeMiddleView === "deposit"}
                    isExpanded={isChartExpanded}
                    isLoggedOut={isHydrated && !isSignedIn}
                    onExpandedChange={setIsChartExpanded}
                    onSelectTab={setChartTab}
                    selectedTab={chartTab}
                    statsPanel={<EarnStatsPanel />}
                  />
                )}
              </div>
              {isEarnRootView ? (
                <MobileTabBar
                  activeTab="earn"
                  onSelect={handleSelectPage}
                  showActivityBadge={hasUnseenActivity}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </BalanceVisibilityProvider>
  );
}
