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
import { EarnedChart } from "@/components/wallet-workspace/facelift/earned-chart";
import { useEarnForecastApyStatus } from "@/components/wallet-workspace/facelift/use-earn-forecast-apy-status";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useIsNarrowViewport } from "@/components/wallet-workspace/facelift/use-is-narrow-viewport";
import { useEarnForecastApyHistory } from "@/hooks/use-earn-forecast-apy-history";
import type { EarnForecastApy } from "@/lib/kamino/earn-forecast.shared";

const ASSET_BASE = "/wallet-workspace/facelift";
const CHART_TABS = ["Forecast", "APY", "Earned"] as const;
const FORECAST_PRINCIPAL_USD = 6000;

type ChartTab = (typeof CHART_TABS)[number];

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
  onAction,
  sectionClassName,
}: {
  actionAriaLabel: string;
  actionIconSrc: string;
  earnData: EarnPositionData;
  footer?: ReactNode;
  isExpanded?: boolean;
  onAction: () => void;
  sectionClassName: string | ((activeTab: ChartTab) => string);
}) {
  // The Earned tab only exists once a position holds a balance (Figma
  // 4693:67592); it becomes the default view when it appears, unless the
  // user already picked a tab by hand.
  const [selectedTab, setSelectedTab] = useState<ChartTab | null>(null);
  const hasEarnedTab = earnData.hasPosition;
  const visibleTabs: readonly ChartTab[] = hasEarnedTab
    ? CHART_TABS
    : CHART_TABS.filter((tab) => tab !== "Earned");
  const activeTab: ChartTab =
    selectedTab && visibleTabs.includes(selectedTab)
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
          <ChartTabs
            activeTab={activeTab}
            onSelect={setSelectedTab}
            tabs={visibleTabs}
          />
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

export function EarnChartPane({
  earnData,
  isExpanded,
  onExpandedChange,
}: {
  earnData: EarnPositionData;
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
}) {
  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
          The Earned tab hugs to the design's 527px (Figma 4693:68847) instead
          of stretching full height. */}
      <EarnChartCard
        actionAriaLabel="Expand chart"
        actionIconSrc={`${ASSET_BASE}/icon-expand.svg`}
        earnData={earnData}
        onAction={() => onExpandedChange(true)}
        // t-resize (transitions.dev card resize) tweens the full-height ↔
        // 527px Earned hug instead of snapping.
        sectionClassName={(activeTab) =>
          `t-resize hidden w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-white min-[1204px]:flex ${
            activeTab === "Earned" ? "h-[527px] self-start" : "h-full"
          }`
        }
      />

      {isExpanded ? (
        // Figma 4693:64989 — enlarged chart covers the middle + right panes;
        // the scrim blurs the rest of the page. On mobile it becomes a bottom
        // sheet on a white scrim (Figma 4693:70200 / 4693:71231).
        <div
          className="fixed inset-0 z-50 flex bg-black/20 p-2 pl-[368px] backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8"
          onClick={() => onExpandedChange(false)}
        >
          <div
            aria-modal="true"
            // Below 1204px (no compact pane) the overlay is the right-pane
            // sized card pinned to the right edge (Figma 4693:88126); at full
            // width it covers the middle + right panes (Figma 4693:64989).
            className="flex h-full w-full min-w-0 max-[1203px]:ml-auto max-[1203px]:w-[400px] max-[795px]:ml-0 max-[795px]:w-full"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <EarnChartCard
              actionAriaLabel="Close expanded chart"
              actionIconSrc={`${ASSET_BASE}/icon-cross.svg`}
              earnData={earnData}
              footer={
                <div className="w-full px-4 pt-2 pb-4 min-[796px]:hidden">
                  <button
                    className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-[#f5f5f5] font-medium text-[16px] text-black leading-5 hover:bg-[#ececec]"
                    onClick={() => onExpandedChange(false)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              }
              isExpanded
              onAction={() => onExpandedChange(false)}
              sectionClassName="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-white max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
