"use client";

import { useState } from "react";

import { WalletReconnectPrompt } from "@/components/auth/wallet-reconnect-prompt";
import { AutodepositPane } from "@/components/wallet-workspace/facelift/autodeposit-pane";
import {
  BalanceVisibilityProvider,
  HiddenBalanceFilterDefs,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { CryptoPage } from "@/components/wallet-workspace/facelift/crypto-page";
import { DepositPane } from "@/components/wallet-workspace/facelift/deposit-pane";
import {
  EarnChartPane,
  type ChartTab,
} from "@/components/wallet-workspace/facelift/earn-chart-pane";
import { EarnEmptyPane } from "@/components/wallet-workspace/facelift/earn-empty-pane";
import { EarnPositionPane } from "@/components/wallet-workspace/facelift/earn-position-pane";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import {
  MiddlePaneSlide,
  PaneReveal,
} from "@/components/wallet-workspace/facelift/pane-transitions";
import { FaceliftSidebar } from "@/components/wallet-workspace/facelift/sidebar";
import { useEarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { WithdrawPane } from "@/components/wallet-workspace/facelift/withdraw-pane";
import { useAuthCapability } from "@/lib/auth/capability";

export type WorkspacePage = "crypto" | "stables" | "earn";

type MiddleView = "earn" | "deposit" | "withdraw" | "autodeposit";

// Figma 4693:64818 — fixed 3-pane workspace: 360px sidebar on the gray shell,
// fluid middle panel, 400px right panel. Panes are intentionally not resizable.
// Below 1204px the right pane would force the dog under its 420px natural size,
// so it hides (Figma 4693:65423) and the middle header shows a chart button
// that opens the expanded chart overlay instead. Below 796px the sidebar goes
// too: screens run full-bleed with a bottom tab bar (Figma 4693:69948 et al.),
// and only the Earn screen with a position keeps the gray card background
// (Figma 4693:70364).
export function WorkspaceFaceliftShell() {
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  // One shared tab choice for every chart card (compact right pane, mobile
  // inline card, enlarged overlay) — enlarging must not reset the tab.
  const [chartTab, setChartTab] = useState<ChartTab | null>(null);
  const [activePage, setActivePage] = useState<WorkspacePage>("earn");
  const [middleView, setMiddleView] = useState<MiddleView>("earn");
  // Set when a positions-tab row's Withdraw pill opened the screen — the
  // withdraw pane preselects that source; header Withdraw clears it.
  const [withdrawSourceKey, setWithdrawSourceKey] = useState<string | null>(
    null
  );
  const { isHydrated, isSignedIn } = useAuthCapability();
  const earnData = useEarnPositionData();
  const handleSelectPage = (page: WorkspacePage) => {
    setActivePage(page);
    // Leaving Earn abandons any in-progress action screen.
    setMiddleView("earn");
  };
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
      <div className="flex h-dvh w-full overflow-clip bg-[#f5f5f5] text-black">
        <HiddenBalanceFilterDefs />
        {/* Wrong-wallet guard for Earn actions — same prompt the old
            workspace mounts (ensureCanSignAccountAction opens it). */}
        <WalletReconnectPrompt
          expectedWalletAddress={earnData.actions.authenticatedWalletAddress}
          onClose={earnData.actions.closeReconnectPrompt}
          onReady={earnData.actions.closeReconnectPrompt}
          open={earnData.actions.isReconnectPromptOpen}
        />
        <FaceliftSidebar
          activePage={activePage}
          earnBalanceUsd={earnData.earnBalanceUsd}
          isEarnBalanceLoading={isPositionLoading}
          onSelectPage={handleSelectPage}
        />
        <div
          className={`flex h-full min-w-0 flex-1 flex-col ${
            isMobileGrayBackground ? "" : "max-[795px]:bg-white"
          }`}
        >
          {activePage !== "earn" ? (
            <CryptoPage
              onEarn={() => {
                // The stables Earn buttons jump straight to the deposit
                // screen, not the Earn root.
                setActivePage("earn");
                setMiddleView("deposit");
              }}
              onSelectEarn={() => handleSelectPage("earn")}
              onSelectWallet={() => handleSelectPage("crypto")}
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
                    isExpanded={isChartExpanded}
                    onExpandedChange={setIsChartExpanded}
                    onSelectTab={setChartTab}
                    selectedTab={chartTab}
                  />
                )}
              </div>
              {isEarnRootView ? (
                <MobileTabBar
                  activeTab="earn"
                  onSelectEarn={() => handleSelectPage("earn")}
                  onSelectWallet={() => handleSelectPage("crypto")}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </BalanceVisibilityProvider>
  );
}
