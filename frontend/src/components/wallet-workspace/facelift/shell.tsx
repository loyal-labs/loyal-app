"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { WalletReconnectPrompt } from "@/components/auth/wallet-reconnect-prompt";
import { AutodepositPane } from "@/components/wallet-workspace/facelift/autodeposit-pane";
import {
  BalanceVisibilityProvider,
  HiddenBalanceFilterDefs,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { readCssDurationMs } from "@/components/wallet-workspace/facelift/css-duration";
import { DepositPane } from "@/components/wallet-workspace/facelift/deposit-pane";
import {
  EarnChartPane,
  type ChartTab,
} from "@/components/wallet-workspace/facelift/earn-chart-pane";
import { EarnEmptyPane } from "@/components/wallet-workspace/facelift/earn-empty-pane";
import { EarnPositionPane } from "@/components/wallet-workspace/facelift/earn-position-pane";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import { FaceliftSidebar } from "@/components/wallet-workspace/facelift/sidebar";
import { useEarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { WithdrawPane } from "@/components/wallet-workspace/facelift/withdraw-pane";
import { useAuthCapability } from "@/lib/auth/capability";

type MiddleView = "earn" | "deposit" | "withdraw" | "autodeposit";

// transitions.dev "panel reveal": the earn pane slides up into the region
// with a cross-blur when it mounts (boot-loader handoff; the earn root now
// stays mounted under the action screens, so returns ride the page slide).
// Rendered closed, flipped open after a forced reflow so the transition
// plays; is-settled then clears the transform so the wrapper stops being a
// containing block for the pane's fixed overlays.
function EarnPaneReveal({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    void el.offsetHeight;
    el.dataset.open = "true";
    const openDur = readCssDurationMs("--panel-open-dur", 400);
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

// transitions.dev "page side-by-side" (frontend/transitions/page-side-by-side.md):
// the Earn root (page 1) and the action screens — deposit/withdraw/autodeposit
// (page 2) — slide between each other. Page 2 mounts in its exit-right state,
// flips in after a forced reflow, and unmounts once the exit completes; the
// settled page drops its transform so fixed overlays inside (mobile sheets)
// anchor to the viewport — same escape EarnPaneReveal uses.
function MiddlePaneSlide({
  actionPane,
  children,
}: {
  actionPane: ReactNode | null;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootPageRef = useRef<HTMLDivElement>(null);
  const actionPageRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [isActionMounted, setIsActionMounted] = useState(false);
  const lastActionPaneRef = useRef<ReactNode>(null);
  const isActionOpen = actionPane !== null;
  if (isActionOpen) {
    lastActionPaneRef.current = actionPane;
  }
  if (isActionOpen && !isActionMounted) {
    setIsActionMounted(true);
  }

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!(container && isActionMounted)) {
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The second pane of multi-pane action screens lags by --page-stagger,
    // so settling/unmounting waits for the delayed transition too.
    const slideDur =
      readCssDurationMs("--page-slide-dur", 250) +
      readCssDurationMs("--page-stagger", 0);
    if (isActionOpen) {
      rootPageRef.current?.classList.remove("is-settled");
      void container.offsetHeight;
      container.dataset.page = "2";
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        actionPageRef.current?.classList.add("is-settled");
      }, slideDur);
      return;
    }
    actionPageRef.current?.classList.remove("is-settled");
    container.dataset.page = "1";
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      rootPageRef.current?.classList.add("is-settled");
      lastActionPaneRef.current = null;
      setIsActionMounted(false);
    }, slideDur);
  }, [isActionOpen, isActionMounted]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  return (
    <div
      className="t-page-slide flex h-full min-w-0 flex-1"
      data-page="1"
      ref={containerRef}
    >
      <div
        className="t-page is-settled flex min-w-0 flex-1"
        data-page-id="1"
        ref={rootPageRef}
      >
        {/* Plain inner wrapper receives the child-motion styles so they
            never collide with EarnPaneReveal's own t-panel-slide transform. */}
        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
      {isActionMounted ? (
        // gap-2 restores the shell row's gap for the action panes' sibling
        // sections (withdraw/autodeposit render two panes themselves).
        <div
          className="t-page flex gap-2 max-[795px]:gap-0"
          data-page-id="2"
          ref={actionPageRef}
        >
          {isActionOpen ? actionPane : lastActionPaneRef.current}
        </div>
      ) : null}
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
  // One shared tab choice for every chart card (compact right pane, mobile
  // inline card, enlarged overlay) — enlarging must not reset the tab.
  const [chartTab, setChartTab] = useState<ChartTab | null>(null);
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
            <MiddlePaneSlide
              actionPane={
                activeMiddleView === "withdraw" ? (
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
                ) : null
              }
            >
              {isPositionLoading ? (
                <section className="flex h-full min-w-0 flex-1 rounded-3xl bg-white max-[795px]:rounded-none" />
              ) : earnData.hasPosition ? (
                <EarnPaneReveal>
                  <EarnPositionPane
                    data={earnData}
                    onDeposit={() => setMiddleView("deposit")}
                    onOpenAutodeposit={() => setMiddleView("autodeposit")}
                    onOpenChart={() => setIsChartExpanded(true)}
                    onSelectChartTab={setChartTab}
                    onWithdraw={() => setMiddleView("withdraw")}
                    selectedChartTab={chartTab}
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
          {isEarnRootView ? <MobileTabBar /> : null}
        </div>
      </div>
    </BalanceVisibilityProvider>
  );
}
