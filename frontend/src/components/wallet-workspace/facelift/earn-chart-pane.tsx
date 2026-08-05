"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  deriveMainUsdcReserveForecastApyBps,
  ForecastChart,
  HistoricalApyChart,
} from "@/components/wallet-sidebar/earn-detail-view";
import { useBalanceVisibility } from "@/components/wallet-workspace/facelift/balance-visibility";
import { readCssDurationMs } from "@/components/wallet-workspace/facelift/css-duration";
import { EarnedChart } from "@/components/wallet-workspace/facelift/earned-chart";
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { useEarnForecastApyStatus } from "@/components/wallet-workspace/facelift/use-earn-forecast-apy-status";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useIsNarrowViewport } from "@/components/wallet-workspace/facelift/use-is-narrow-viewport";
import { useEarnForecastApyHistory } from "@/hooks/use-earn-forecast-apy-history";
import type { EarnForecastApy } from "@/lib/kamino/earn-forecast.shared";

const ASSET_BASE = "/wallet-workspace/facelift";
const CHART_TABS = ["Forecast", "APY", "Earned"] as const;
const FORECAST_PRINCIPAL_USD = 6000;

export type ChartTab = (typeof CHART_TABS)[number];

// transitions.dev "Tabs sliding" (frontend/transitions/tabs-sliding.md): the
// white active pill is one absolutely-positioned span that tweens between the
// measured offset/width of the selected tab. First paint and resizes write
// the position with transitions suspended so the pill snaps, never flies in.
function ChartTabs({
  activeTab,
  onSelect,
  tabs,
}: {
  activeTab: ChartTab;
  onSelect: (tab: ChartTab) => void;
  tabs: readonly ChartTab[];
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const hasPainted = useRef(false);

  const movePillToActiveTab = useCallback((animate: boolean) => {
    const bar = barRef.current;
    const pill = pillRef.current;
    const active = bar?.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]'
    );
    if (!(bar && pill && active)) {
      return;
    }
    if (animate) {
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      pill.style.width = `${active.offsetWidth}px`;
      return;
    }
    const previousTransition = pill.style.transition;
    pill.style.transition = "none";
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    void pill.offsetWidth;
    pill.style.transition = previousTransition;
  }, []);

  // Re-measure when the tab set changes too (Earned appears with a position).
  useLayoutEffect(() => {
    movePillToActiveTab(hasPainted.current);
    hasPainted.current = true;
  }, [activeTab, movePillToActiveTab, tabs.length]);

  useEffect(() => {
    const handleResize = () => movePillToActiveTab(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [movePillToActiveTab]);

  return (
    <div className="t-tabs" ref={barRef} role="tablist">
      <span aria-hidden="true" className="t-tabs-pill" ref={pillRef} />
      {tabs.map((tab) => (
        <button
          aria-selected={activeTab === tab}
          className="t-tab whitespace-nowrap font-medium text-[14px] leading-5"
          key={tab}
          onClick={() => onSelect(tab)}
          role="tab"
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function ChartBody({
  activeTab,
  apy,
  earnData,
  isApyLoaded,
  isExpanded = false,
  mainUsdcReserveApyBps,
}: {
  activeTab: ChartTab;
  apy: EarnForecastApy;
  earnData: EarnPositionData;
  isApyLoaded: boolean;
  isExpanded?: boolean;
  mainUsdcReserveApyBps: number;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const isNarrowViewport = useIsNarrowViewport();
  // Same source the old workspace feeds the forecast: the live position
  // balance once one exists, the marketing principal otherwise.
  const forecastPrincipal =
    earnData.hasPosition && earnData.earnBalanceUsd > 0
      ? earnData.earnBalanceUsd
      : FORECAST_PRINCIPAL_USD;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-6 pt-2 pb-6">
      {activeTab === "Earned" ? (
        <EarnedChart data={earnData} />
      ) : activeTab === "APY" ? (
        // The wide overlay fits the design's 8 date ticks (Figma 4693:65002);
        // the compact pane and the mobile sheet keep the start/end pair.
        <HistoricalApyChart
          apyDataRevealed={isApyLoaded}
          axisTickCount={isExpanded && !isNarrowViewport ? 8 : 2}
          rangeId="30D"
        />
      ) : (
        <ForecastChart
          apy={apy}
          apyDataRevealed={isApyLoaded}
          isBalanceHidden={isBalanceHidden && earnData.hasPosition}
          key={forecastPrincipal}
          mainUsdcReserveApyBps={mainUsdcReserveApyBps}
          principal={forecastPrincipal}
          scrambleHiddenValues
        />
      )}
    </div>
  );
}

// One chart card = tabs header + action icon + chart body, with its own tab
// state. Used three ways: the desktop right pane, the mobile inline card on
// the Earn screen, and the expanded overlay/bottom sheet.
export function EarnChartCard({
  actionAriaLabel,
  actionIconSrc,
  earnData,
  footer,
  isExpanded = false,
  isLoggedOut = false,
  onAction,
  onSelectTab,
  sectionClassName,
  selectedTab,
}: {
  actionAriaLabel: string;
  actionIconSrc: string;
  earnData: EarnPositionData;
  footer?: ReactNode;
  isExpanded?: boolean;
  // Logged-out visitors get no tab bar — just the APY chart under an "APY"
  // title (Figma 4884:36664); Forecast needs a session's balance context.
  isLoggedOut?: boolean;
  onAction: () => void;
  // Tab choice lives in the shell so the compact pane, the mobile inline
  // card and the enlarged overlay all show the same tab.
  onSelectTab: (tab: ChartTab) => void;
  sectionClassName: string | ((activeTab: ChartTab) => string);
  selectedTab: ChartTab | null;
}) {
  // The Earned tab only exists once a position holds a balance (Figma
  // 4693:67592); it becomes the default view when it appears, unless the
  // user already picked a tab by hand.
  const hasEarnedTab = earnData.hasPosition;
  const visibleTabs: readonly ChartTab[] = hasEarnedTab
    ? CHART_TABS
    : CHART_TABS.filter((tab) => tab !== "Earned");
  const activeTab: ChartTab = isLoggedOut
    ? "APY"
    : selectedTab && visibleTabs.includes(selectedTab)
    ? selectedTab
    : hasEarnedTab
    ? "Earned"
    : "APY";
  // Forecast + history ride the same cached summary fetch, so one loaded
  // flag gates every APY-fed number in the chart pane.
  const { apy, isLoaded: isApyLoaded } = useEarnForecastApyStatus();
  const apyHistory = useEarnForecastApyHistory();
  const mainUsdcReserveApyBps = deriveMainUsdcReserveForecastApyBps(apyHistory);

  return (
    <section
      className={
        typeof sectionClassName === "function"
          ? sectionClassName(activeTab)
          : sectionClassName
      }
    >
      <header className="flex w-full items-center p-2">
        <div className="min-w-0 flex-1">
          {isLoggedOut ? (
            <div className="flex items-center gap-2 py-2.5 pl-4">
              <h2 className="truncate font-semibold text-[20px] text-black leading-6">
                APY
              </h2>
              <InfoTooltip
                iconClassName="size-6"
                // Bottom placement: this header sits at the very top of its
                // card/sheet, so an upward bubble gets clipped.
                placement="bottom"
                text="Historical APY of the Loyal Earn strategy over the last 30 days."
              />
            </div>
          ) : (
            <ChartTabs
              activeTab={activeTab}
              onSelect={onSelectTab}
              tabs={visibleTabs}
            />
          )}
        </div>
        <button
          aria-label={actionAriaLabel}
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
          onClick={onAction}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={actionIconSrc}
          />
        </button>
      </header>
      <ChartBody
        activeTab={activeTab}
        apy={apy}
        earnData={earnData}
        isApyLoaded={isApyLoaded}
        isExpanded={isExpanded}
        mainUsdcReserveApyBps={mainUsdcReserveApyBps}
      />
      {footer}
    </section>
  );
}

// Figma 4693:64989 — enlarged chart covers the middle + right panes; the
// scrim blurs the rest of the page. On mobile it becomes a bottom sheet on a
// white scrim (Figma 4693:70200 / 4693:71231).
// Motion: the scrim cross-fades on the modal recipe's backdrop clock, and at
// ≥1204px the overlay card mounts congruent with the compact right-pane card
// then enlarges leftward on the t-resize clock (transitions.dev card resize).
// Kept mounted while closing so the fade-out plays before unmount.
function ExpandedChartOverlay({
  earnData,
  isLoggedOut = false,
  isOpen,
  onClose,
  onSelectTab,
  selectedTab,
}: {
  earnData: EarnPositionData;
  isLoggedOut?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: ChartTab) => void;
  selectedTab: ChartTab | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  if (isOpen && !isMounted) {
    setIsMounted(true);
  }

  useLayoutEffect(() => {
    const container = containerRef.current;
    const slide = slideRef.current;
    const dialog = dialogRef.current;
    if (!(container && slide && dialog)) {
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const isSlideViewport = window.matchMedia("(max-width: 1203px)").matches;
    if (isOpen) {
      container.dataset.state = "open";
      // Below 1204px the surface rises (and slides back down on close) on
      // the panel-reveal keyframes — bottom sheet on mobile, right-pinned
      // card in between. At ≥1204px the attribute never lands, so nothing
      // rises there: the congruent width tween below owns that entrance.
      if (isSlideViewport) {
        slide.dataset.state = "open";
      }
      if (window.matchMedia("(min-width: 1204px)").matches) {
        dialog.style.width = "";
        dialog.style.marginLeft = "";
        const targetWidth = dialog.offsetWidth;
        dialog.style.width = "400px";
        dialog.style.marginLeft = "auto";
        void dialog.offsetWidth;
        dialog.style.width = `${targetWidth}px`;
        const resizeDur = readCssDurationMs("--resize-dur", 300);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          dialog.style.width = "";
          dialog.style.marginLeft = "";
        }, resizeDur);
      }
      return;
    }
    container.dataset.state = "closed";
    if (isSlideViewport) {
      slide.dataset.state = "closed";
    }
    // Read after the state flip so the computed duration reflects the
    // closed-state (and viewport-specific) animation; on mobile the sheet's
    // slide-down (panel clock) can outlast the scrim fade.
    const scrimDur =
      Number.parseFloat(getComputedStyle(container).animationDuration) * 1000 ||
      150;
    const panelDur = isSlideViewport
      ? readCssDurationMs("--panel-close-dur", 350)
      : 0;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setIsMounted(false);
    }, Math.max(scrimDur, panelDur));
  }, [isOpen, isMounted]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  if (!isMounted) {
    return null;
  }
  return (
    <div
      className="t-modal-overlay fixed inset-0 z-50 flex bg-black/20 p-2 pl-[368px] backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8"
      data-state="open"
      onClick={onClose}
      ref={containerRef}
    >
      {/* Sub-1204 sheet rise lives on this wrapper — never on the dialog
          itself, whose t-resize transition list it would clobber. No
          data-state at rest: the keyframes only run once the effect stamps
          it, which it never does at ≥1204px. */}
      <div className="t-sheet-panel flex h-full w-full min-w-0" ref={slideRef}>
        <div
          aria-modal="true"
          // Below 1204px (no compact pane) the overlay is the right-pane
          // sized card pinned to the right edge (Figma 4693:88126); at full
          // width it covers the middle + right panes (Figma 4693:64989).
          className="t-resize flex h-full w-full min-w-0 max-[1203px]:ml-auto max-[1203px]:w-[400px] max-[795px]:ml-0 max-[795px]:w-full"
          onClick={(event) => event.stopPropagation()}
          ref={dialogRef}
          role="dialog"
        >
          <EarnChartCard
            actionAriaLabel="Close expanded chart"
            actionIconSrc={`${ASSET_BASE}/icon-cross.svg`}
            earnData={earnData}
            isLoggedOut={isLoggedOut}
            footer={
              <div className="w-full px-4 pt-2 pb-4 min-[796px]:hidden">
                <button
                  className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-[#f5f5f5] font-medium text-[16px] text-black leading-5 hover:bg-[#ececec]"
                  onClick={onClose}
                  type="button"
                >
                  Close
                </button>
              </div>
            }
            isExpanded
            onAction={onClose}
            onSelectTab={onSelectTab}
            sectionClassName="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-white max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
            selectedTab={selectedTab}
          />
        </div>
      </div>
    </div>
  );
}

export function EarnChartPane({
  banner,
  earnData,
  hideAside = false,
  isExpanded,
  isLoggedOut = false,
  onExpandedChange,
  onSelectTab,
  selectedTab,
  statsPanel,
}: {
  // Optional promo banner (EarnBanners) overlaying the bottom of the right
  // pane — Earn root only; slotted in so the shell owns its actions.
  banner?: ReactNode;
  earnData: EarnPositionData;
  // Action screens (deposit) drop the right chart/stats column but keep the
  // expanded overlay reachable from their own chart button.
  hideAside?: boolean;
  isExpanded: boolean;
  isLoggedOut?: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  onSelectTab: (tab: ChartTab) => void;
  selectedTab: ChartTab | null;
  // The Stats card rendered under the chart card (Figma 4884:36662). Slotted
  // in so the overlay portal can stay outside the responsive-hidden column.
  statsPanel?: ReactNode;
}) {
  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onExpandedChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, onExpandedChange]);

  return (
    <>
      {/* Hidden below 1204px so the middle pane never shrinks the dog under
          420px (Figma 4693:65423); the chart stays reachable via the overlay.
          Every tab shares the Earned hug height (527px, Figma 4693:68847);
          the Stats card scrolls into view below it (Figma 4884:36662). */}
      {/* hideAside (deposit): the action pane brings its own 400px explainer
          aside in the chart column's place, so no reserved slot is needed —
          only the expanded overlay below stays mounted. */}
      {hideAside ? null : (
        <div className="hidden h-full w-[400px] shrink-0 flex-col gap-2 overflow-y-auto [scrollbar-width:none] min-[1204px]:flex [&::-webkit-scrollbar]:hidden">
          <EarnChartCard
            actionAriaLabel="Expand chart"
            actionIconSrc={`${ASSET_BASE}/icon-expand.svg`}
            earnData={earnData}
            isLoggedOut={isLoggedOut}
            onAction={() => onExpandedChange(true)}
            onSelectTab={onSelectTab}
            sectionClassName="flex h-[527px] w-full shrink-0 flex-col overflow-clip rounded-3xl bg-white"
            selectedTab={selectedTab}
          />
          {statsPanel}
          {/* Last flow child + sticky bottom: pinned to the pane's bottom
              edge while scrolling, yet it reserves its own height so the
              cards above stay fully reachable at the end of the scroll. */}
          {banner}
        </div>
      )}

      <ExpandedChartOverlay
        earnData={earnData}
        isLoggedOut={isLoggedOut}
        isOpen={isExpanded}
        onClose={() => onExpandedChange(false)}
        onSelectTab={onSelectTab}
        selectedTab={selectedTab}
      />
    </>
  );
}
