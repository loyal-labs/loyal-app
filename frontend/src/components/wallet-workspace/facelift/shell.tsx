"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { WalletReconnectPrompt } from "@/components/auth/wallet-reconnect-prompt";
import { AutodepositPane } from "@/components/wallet-workspace/facelift/autodeposit-pane";
import {
  BalanceVisibilityProvider,
  HiddenBalanceFilterDefs,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { DepositPane } from "@/components/wallet-workspace/facelift/deposit-pane";
import { EarnChartPane } from "@/components/wallet-workspace/facelift/earn-chart-pane";
import { EarnEmptyPane } from "@/components/wallet-workspace/facelift/earn-empty-pane";
import { EarnPositionPane } from "@/components/wallet-workspace/facelift/earn-position-pane";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import { FaceliftSidebar } from "@/components/wallet-workspace/facelift/sidebar";
import { useEarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { WithdrawPane } from "@/components/wallet-workspace/facelift/withdraw-pane";
import { useAuthCapability } from "@/lib/auth/capability";

type MiddleView = "earn" | "deposit" | "withdraw" | "autodeposit";

// transitions.dev "panel reveal": the earn pane slides up into the region
// with a cross-blur when it mounts (boot-loader handoff, returning from
// deposit/withdraw). Rendered closed, flipped open after a forced reflow so
// the transition plays; is-settled then clears the transform so the wrapper
// stops being a containing block for the pane's fixed overlays.
function EarnPaneReveal({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    void el.offsetHeight;
    el.dataset.open = "true";
    const openDur =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--panel-open-dur"
        )
      ) || 400;
    const timer = window.setTimeout(
      () => el.classList.add("is-settled"),
      openDur
    );
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="t-panel-slide flex h-full min-w-0 flex-1 flex-col"
      data-open="false"
      ref={wrapRef}
      style={{ ["--panel-translate-y" as never]: "24px" }}
    >
      {children}
    </div>
  );
}

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
  const [middleView, setMiddleView] = useState<MiddleView>("earn");
  const { isHydrated, isSignedIn } = useAuthCapability();
  const earnData = useEarnPositionData();
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
    isEarnRootView && earnData.hasPosition && !isPositionLoading;

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
          earnBalanceUsd={earnData.earnBalanceUsd}
          isEarnBalanceLoading={isPositionLoading}
        />
        <div
          className={`flex h-full min-w-0 flex-1 flex-col ${
            isMobileGrayBackground ? "" : "max-[795px]:bg-white"
          }`}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
            {activeMiddleView === "withdraw" ? (
              <WithdrawPane
                data={earnData}
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
            ) : isPositionLoading ? (
              <section className="flex h-full min-w-0 flex-1 rounded-3xl bg-white max-[795px]:rounded-none" />
            ) : earnData.hasPosition ? (
              <EarnPaneReveal>
                <EarnPositionPane
                  data={earnData}
                  onDeposit={() => setMiddleView("deposit")}
                  onOpenAutodeposit={() => setMiddleView("autodeposit")}
                  onOpenChart={() => setIsChartExpanded(true)}
                  onWithdraw={() => setMiddleView("withdraw")}
                />
              </EarnPaneReveal>
            ) : (
              <EarnPaneReveal>
                <EarnEmptyPane
                  onDeposit={() => setMiddleView("deposit")}
                  onOpenChart={() => setIsChartExpanded(true)}
                />
              </EarnPaneReveal>
            )}
            {activeMiddleView === "withdraw" ||
            activeMiddleView === "autodeposit" ? null : (
              <EarnChartPane
                earnData={earnData}
                isExpanded={isChartExpanded}
                onExpandedChange={setIsChartExpanded}
              />
            )}
          </div>
          {isEarnRootView ? <MobileTabBar /> : null}
        </div>
      </div>
    </BalanceVisibilityProvider>
  );
}
