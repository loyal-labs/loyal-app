"use client";

import { useEffect, useState } from "react";

import {
  deriveMainUsdcReserveForecastApyBps,
  ForecastChart,
  HistoricalApyChart,
} from "@/components/wallet-sidebar/earn-detail-view";
import { useBalanceVisibility } from "@/components/wallet-workspace/facelift/balance-visibility";
import { EarnedChart } from "@/components/wallet-workspace/facelift/earned-chart";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import { useEarnForecastApyHistory } from "@/hooks/use-earn-forecast-apy-history";
import type { EarnForecastApy } from "@/lib/kamino/earn-forecast.shared";

const ASSET_BASE = "/wallet-workspace/facelift";
const CHART_TABS = ["Forecast", "APY", "Earned"] as const;
const FORECAST_PRINCIPAL_USD = 6000;

type ChartTab = (typeof CHART_TABS)[number];

function ChartTabs({
  activeTab,
  onSelect,
  tabs,
}: {
  activeTab: ChartTab;
  onSelect: (tab: ChartTab) => void;
  tabs: readonly ChartTab[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] p-1">
      {tabs.map((tab) => (
        <button
          className={`rounded-full px-4 py-2 font-medium text-[14px] text-black leading-5 ${
            activeTab === tab ? "bg-white" : ""
          }`}
          key={tab}
          onClick={() => onSelect(tab)}
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
  isExpanded = false,
  mainUsdcReserveApyBps,
}: {
  activeTab: ChartTab;
  apy: EarnForecastApy;
  earnData: EarnPositionData;
  isExpanded?: boolean;
  mainUsdcReserveApyBps: number;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
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
        // the compact pane keeps just the start/end pair.
        <HistoricalApyChart
          axisTickCount={isExpanded ? 8 : 2}
          rangeId="30D"
        />
      ) : (
        <ForecastChart
          apy={apy}
          isBalanceHidden={isBalanceHidden && earnData.hasPosition}
          key={forecastPrincipal}
          mainUsdcReserveApyBps={mainUsdcReserveApyBps}
          principal={forecastPrincipal}
        />
      )}
    </div>
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
  const apy = useEarnForecastApy();
  const apyHistory = useEarnForecastApyHistory();
  const mainUsdcReserveApyBps =
    deriveMainUsdcReserveForecastApyBps(apyHistory);

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
      <section
        className={`hidden w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-white min-[1204px]:flex ${
          activeTab === "Earned" ? "h-[527px] self-start" : "h-full"
        }`}
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
            aria-label="Expand chart"
            className="flex size-11 shrink-0 items-center justify-center rounded-3xl"
            onClick={() => onExpandedChange(true)}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-6"
              src={`${ASSET_BASE}/icon-expand.svg`}
            />
          </button>
        </header>
        <ChartBody
          activeTab={activeTab}
          apy={apy}
          earnData={earnData}
          mainUsdcReserveApyBps={mainUsdcReserveApyBps}
        />
      </section>

      {isExpanded ? (
        // Figma 4693:64989 — enlarged chart covers the middle + right panes;
        // the scrim blurs the rest of the page.
        <div
          className="fixed inset-0 z-50 flex bg-black/20 p-2 pl-[368px] backdrop-blur-[4px]"
          onClick={() => onExpandedChange(false)}
        >
          <div
            aria-modal="true"
            // Below 1204px (no compact pane) the overlay is the right-pane
            // sized card pinned to the right edge (Figma 4693:88126); at full
            // width it covers the middle + right panes (Figma 4693:64989).
            className="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-white max-[1203px]:ml-auto max-[1203px]:w-[400px]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
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
                aria-label="Close expanded chart"
                className="flex size-11 shrink-0 items-center justify-center rounded-3xl"
                onClick={() => onExpandedChange(false)}
                type="button"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-6"
                  src={`${ASSET_BASE}/icon-cross.svg`}
                />
              </button>
            </header>
            <ChartBody
              activeTab={activeTab}
              apy={apy}
              earnData={earnData}
              isExpanded
              mainUsdcReserveApyBps={mainUsdcReserveApyBps}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
