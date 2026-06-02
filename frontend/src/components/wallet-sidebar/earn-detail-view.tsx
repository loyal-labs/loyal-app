"use client";

import NumberFlow, { continuous } from "@number-flow/react";
import {
  ArrowUp,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import {
  FALLBACK_EARN_FORECAST,
  formatEarnApyLabel,
  formatEarnApyPercent,
  getEarnForecastTargetMultiplier,
  type EarnForecastApy,
} from "@/lib/kamino/earn-forecast.shared";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

const TOP_EARN_VAULT = {
  label: "Kamino · Lending Yield",
  logo: "/wallet-workspace/earn-kamino.png",
} as const;

const TOP_DEPOSIT_VAULT = {
  label: "Kamino · Lending Yield",
  logo: "/wallet-workspace/earn-deposit-kamino.png",
} as const;

const EARN_CHART_WIDTH = 508;
const EARN_CHART_HEIGHT = 260;
const EARN_CHART_BASELINE = 238;
const EARN_CHART_TOP = 12;
const MIN_DEPOSIT_USDC = 0.5;
const EARN_BALANCE_DECIMALS = 6;
const EARN_BALANCE_INITIAL_VALUE = 1000.000006;
const EARN_BALANCE_PRINCIPAL = 1000;
const EARN_BALANCE_SAMPLE_MS = 250;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const EARN_NUMBER_FLOW_PLUGINS = [continuous];
const FALLBACK_EARN_APY = {
  apyBps: FALLBACK_EARN_FORECAST.apyBps,
  rangeHighBps: FALLBACK_EARN_FORECAST.rangeHighBps,
  rangeLowBps: FALLBACK_EARN_FORECAST.rangeLowBps,
} as const satisfies EarnForecastApy;

export type EarnDepositSourceOption = {
  addressLabel: string;
  balance: number;
  balanceFraction: string;
  balanceWhole: string;
  decimals: number;
  icon: string;
  id: string;
  label: string;
  mint: string | null;
};

const FALLBACK_EARN_DEPOSIT_SOURCES: EarnDepositSourceOption[] = [
  {
    addressLabel: "2Lzb…UQUu",
    balance: 1280,
    balanceFraction: "00",
    balanceWhole: "1,280",
    decimals: 6,
    icon: "/agents/Agent-01.svg",
    id: "main",
    label: "Main",
    mint: null,
  },
  {
    addressLabel: "9xQe…3Kf8",
    balance: 12_346.28,
    balanceFraction: "28",
    balanceWhole: "12,346",
    decimals: 6,
    icon: "/agents/Stashx.svg",
    id: "stash",
    label: "Stash",
    mint: null,
  },
];

export type EarnDepositCompletion = {
  amount: number;
  source: EarnDepositSourceOption;
};

export type EarnDepositDraft = {
  amount: number;
  amountLabel: string;
  forecastApyBps: number;
  source: EarnDepositSourceOption;
  symbol: "USDC";
  tokenDecimals: number;
  tokenMint: string | null;
};

type EarnChartPoint = {
  date: string;
  highValue: number;
  index: number;
  lowValue: number;
  value: number;
  yieldUsd: number;
};

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatDepositAmount(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  });
}

export function clampDepositAmountInput(rawValue: string, balance: number) {
  if (rawValue === "") {
    return "";
  }

  if (!/^[\d,]*\.?\d*$/.test(rawValue)) {
    return null;
  }

  const numericValue = Number.parseFloat(rawValue.replace(/,/g, "")) || 0;
  if (numericValue > balance) {
    return formatDepositAmount(balance);
  }

  return rawValue;
}

function formatForecastMoney(value: number, mutedFraction = false) {
  const [whole, fraction = "00"] = formatMoney(value).split(".");
  return (
    <>
      ${whole}
      <span style={{ color: mutedFraction ? "rgba(60, 60, 67, 0.4)" : "inherit" }}>
        .{fraction}
      </span>
    </>
  );
}

const FORECAST_DATES = [
  "May 2026",
  "Jun 2026",
  "Jul 2026",
  "Aug 2026",
  "Sep 2026",
  "Oct 2026",
  "Nov 2026",
  "Dec 2026",
  "Jan 2027",
  "Feb 2027",
  "Mar 2027",
  "Apr 2027",
  "May 2027",
];

const FORECAST_AMOUNT_PRESETS = [
  { label: "$100", value: 100 },
  { label: "$500", value: 500 },
  { label: "$1,000", value: 1000 },
  { label: "$5,000", value: 5000 },
] as const;

export function buildEarnChartPoints(
  principal: number,
  apy: EarnForecastApy = FALLBACK_EARN_APY
): EarnChartPoint[] {
  const months = 12;
  const target = principal * getEarnForecastTargetMultiplier(apy.apyBps);
  const lowTarget = principal * getEarnForecastTargetMultiplier(apy.rangeLowBps);
  const highTarget = principal *
    getEarnForecastTargetMultiplier(apy.rangeHighBps);

  return Array.from({ length: months + 1 }, (_, index) => {
    const progress = index / months;
    const eased = Math.pow(progress, 1.08);
    const value = principal + (target - principal) * eased;
    return {
      date: FORECAST_DATES[index] ?? FORECAST_DATES[FORECAST_DATES.length - 1],
      highValue: principal + (highTarget - principal) * progress,
      index,
      lowValue: principal + (lowTarget - principal) * progress,
      value,
      yieldUsd: value - principal,
    };
  });
}

function getEarnApyRate(apyBps: number): number {
  return apyBps / 10_000;
}

function getEarningsRatePerSecond(apyBps: number): number {
  return (
    (EARN_BALANCE_PRINCIPAL * getEarnApyRate(apyBps)) / SECONDS_PER_YEAR
  );
}

function EarnYieldIcon({ size = 64 }: { size?: number }) {
  const scale = size / 64;

  return (
    <span
      aria-hidden="true"
      style={{
        background: "#32B67C",
        borderRadius: `${16 * scale}px`,
        display: "inline-block",
        flexShrink: 0,
        height: size,
        overflow: "hidden",
        position: "relative",
        width: size,
      }}
    >
      <span
        style={{
          background: "#fff",
          borderRadius: `${2.667 * scale}px`,
          height: `${21.333 * scale}px`,
          left: `${10.67 * scale}px`,
          position: "absolute",
          top: `${32 * scale}px`,
          width: `${8 * scale}px`,
        }}
      />
      <span
        style={{
          background: "#fff",
          borderRadius: `${2.667 * scale}px`,
          height: `${42.667 * scale}px`,
          left: `${28 * scale}px`,
          position: "absolute",
          top: `${10.67 * scale}px`,
          width: `${8 * scale}px`,
        }}
      />
      <span
        style={{
          background: "#fff",
          borderRadius: `${2.667 * scale}px`,
          height: `${32 * scale}px`,
          left: `${45.33 * scale}px`,
          position: "absolute",
          top: `${21.33 * scale}px`,
          width: `${8 * scale}px`,
        }}
      />
    </span>
  );
}

function ApyBadge({ value }: { value: string }) {
  return (
    <span
      style={{
        alignItems: "center",
        background: "rgba(52, 199, 89, 0.14)",
        borderRadius: "6px",
        color: "#34C759",
        display: "inline-flex",
        fontFamily: font,
        fontSize: "16px",
        fontWeight: 500,
        gap: "4px",
        lineHeight: "20px",
        padding: "1px 4px",
        whiteSpace: "nowrap",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden="true"
        src="/wallet-workspace/earn-flash.svg"
        style={{ height: "20px", width: "12px" }}
      />
      {value}
    </span>
  );
}

function VaultIcon({ logo }: { logo: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flexShrink: 0,
        height: "48px",
        position: "relative",
        width: "48px",
      }}
    >
      <span
        style={{
          border: "2.286px solid #fff",
          borderRadius: "80px",
          height: "32px",
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-vault-usdc.png"
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-vault-usdc-overlay.png"
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      </span>
      <span
        style={{
          borderRadius: "80px",
          bottom: 0,
          height: "32px",
          overflow: "hidden",
          position: "absolute",
          right: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={logo}
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      </span>
    </span>
  );
}

function DepositButton({
  dark = false,
  onClick,
  withIcon = false,
}: {
  dark?: boolean;
  onClick?: () => void;
  withIcon?: boolean;
}) {
  return (
    <>
      <style jsx>{`
        .earn-detail-deposit,
        .earn-detail-deposit-dark {
          transition:
            background 0.15s ease,
            transform 0.15s ease;
        }
        .earn-detail-deposit:hover {
          background: rgba(0, 0, 0, 0.08) !important;
          transform: translateY(-1px);
        }
        .earn-detail-deposit-dark:hover {
          background: #222 !important;
          transform: translateY(-1px);
        }
        .earn-detail-deposit:active,
        .earn-detail-deposit-dark:active {
          transform: translateY(0);
        }
      `}</style>
      <button
        className={dark ? "earn-detail-deposit-dark" : "earn-detail-deposit"}
        onClick={onClick}
        style={{
          alignItems: "center",
          background: dark ? "#000" : "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: dark ? "#fff" : "#000",
          cursor: "pointer",
          display: "inline-flex",
          flexShrink: 0,
          fontFamily: font,
          fontSize: "14px",
          fontWeight: 500,
          gap: "6px",
          justifyContent: "center",
          lineHeight: "20px",
          padding: withIcon ? "6px 16px 6px 6px" : "6px 16px",
          whiteSpace: "nowrap",
        }}
        type="button"
      >
        {withIcon ? (
          <span
            style={{
              alignItems: "center",
              display: "inline-flex",
              height: "24px",
              justifyContent: "center",
              width: "24px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              src="/wallet-workspace/earn-plus.svg"
              style={{ height: "16px", width: "16px" }}
            />
          </span>
        ) : null}
        Deposit
      </button>
    </>
  );
}

function EarnGrowingBalance({ apyBps }: { apyBps: number }) {
  const [value, setValue] = useState(EARN_BALANCE_INITIAL_VALUE);

  useEffect(() => {
    const ratePerSecond = getEarningsRatePerSecond(apyBps);
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      const earned = ratePerSecond * elapsedSeconds;

      setValue(
        Number(
          (EARN_BALANCE_INITIAL_VALUE + earned).toFixed(EARN_BALANCE_DECIMALS)
        )
      );
    }, EARN_BALANCE_SAMPLE_MS);

    return () => window.clearInterval(interval);
  }, [apyBps]);

  return (
    <>
      <style jsx>{`
        :global(.earn-growing-balance-flow) {
          --number-flow-mask-height: 0.12em;
          --number-flow-mask-width: 0.24em;
          color: #000;
          font-family: ${font};
          font-size: 40px;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          line-height: 48px;
        }
        :global(.earn-growing-balance-flow::part(decimal)),
        :global(.earn-growing-balance-flow::part(fraction)) {
          color: rgba(60, 60, 67, 0.4);
        }
      `}</style>
      <NumberFlow
        className="earn-growing-balance-flow"
        format={{
          maximumFractionDigits: EARN_BALANCE_DECIMALS,
          minimumFractionDigits: EARN_BALANCE_DECIMALS,
          useGrouping: true,
        }}
        opacityTiming={{ duration: 280, easing: "ease-out" }}
        plugins={EARN_NUMBER_FLOW_PLUGINS}
        prefix="$"
        spinTiming={{ duration: 900, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
        transformTiming={{
          duration: 900,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
        trend={1}
        value={value}
      />
    </>
  );
}

const EARNINGS_DEPOSIT_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;
const EARNINGS_CHART_HEIGHT = 242;
const EARNINGS_DAY_MS = 24 * 60 * 60 * 1000;
const EARNINGS_RANGES = [
  {
    bars: 7,
    binMs: EARNINGS_DAY_MS,
    id: "1W",
    label: "1W",
    rangeSubtitle: "Past Week",
  },
  {
    bars: 30,
    binMs: EARNINGS_DAY_MS,
    id: "1M",
    label: "1M",
    rangeSubtitle: "Past Month",
  },
  {
    bars: 26,
    binMs: 7 * EARNINGS_DAY_MS,
    id: "6M",
    label: "6M",
    rangeSubtitle: "Past 6 Months",
  },
  {
    bars: 12,
    binMs: Math.round((365 / 12) * EARNINGS_DAY_MS),
    id: "1Y",
    label: "1Y",
    rangeSubtitle: "Past Year",
  },
] as const;

type EarningsRangeId = (typeof EARNINGS_RANGES)[number]["id"];

function formatEarningsAmount(value: number) {
  const formatted = value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  return `+$${formatted}`;
}

function formatEarningsBarDate(endMs: number, rangeId: EarningsRangeId) {
  const date = new Date(endMs);
  if (rangeId === "1Y") {
    return date.toLocaleString("en-US", { month: "short", year: "numeric" });
  }
  if (rangeId === "6M") {
    return date.toLocaleString("en-US", { day: "numeric", month: "short" });
  }
  return date.toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    month: "short",
  });
}

function EarningsBlock({ apy }: { apy: EarnForecastApy }) {
  const [activeTab, setActiveTab] = useState<"Earnings" | "Forecast">(
    "Earnings"
  );
  const [earningsRevision, setEarningsRevision] = useState(0);
  const [forecastRevision, setForecastRevision] = useState(0);
  const [rangeId, setRangeId] = useState<EarningsRangeId>("1M");
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const handleTabChange = (next: "Earnings" | "Forecast") => {
    if (next === activeTab) return;
    setActiveTab(next);
    setHoveredBar(null);
    if (next === "Earnings") {
      setEarningsRevision((r) => r + 1);
    } else {
      setForecastRevision((r) => r + 1);
    }
  };
  const depositAtRef = useRef<number | null>(null);
  if (depositAtRef.current === null) {
    depositAtRef.current = Date.now() - EARNINGS_DEPOSIT_OFFSET_MS;
  }
  const depositAt = depositAtRef.current;
  const forecastPrincipalRef = useRef<number | null>(null);
  if (forecastPrincipalRef.current === null) {
    const elapsedSec = Math.max(0, (Date.now() - depositAt) / 1000);
    forecastPrincipalRef.current =
      EARN_BALANCE_PRINCIPAL + elapsedSec * getEarningsRatePerSecond(apy.apyBps);
  }
  const forecastAmount = forecastPrincipalRef.current;

  const range =
    EARNINGS_RANGES.find((r) => r.id === rangeId) ?? EARNINGS_RANGES[1];

  const bars = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: range.bars }, (_, i) => {
      const endMs = now - (range.bars - 1 - i) * range.binMs;
      const elapsedSec = Math.max(0, (endMs - depositAt) / 1000);
      const value = elapsedSec * getEarningsRatePerSecond(apy.apyBps);
      return { endMs, value };
    });
  }, [apy.apyBps, range.bars, range.binMs, depositAt]);

  const maxValue = useMemo(() => {
    const peak = Math.max(...bars.map((b) => b.value), 0.01);
    return Math.max(1, Math.ceil(peak));
  }, [bars]);

  const initialLive =
    Math.max(0, (Date.now() - depositAt) / 1000) *
    getEarningsRatePerSecond(apy.apyBps);
  const [liveTotal, setLiveTotal] = useState<number>(initialLive);
  useEffect(() => {
    const ratePerSecond = getEarningsRatePerSecond(apy.apyBps);
    const id = window.setInterval(() => {
      const next = Math.max(0, (Date.now() - depositAt) / 1000) *
        ratePerSecond;
      setLiveTotal(Number(next.toFixed(EARN_BALANCE_DECIMALS)));
    }, EARN_BALANCE_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [apy.apyBps, depositAt]);

  const hoveredBarEntry = hoveredBar !== null ? bars[hoveredBar] : null;
  const displayValue = hoveredBarEntry ? hoveredBarEntry.value : liveTotal;

  const subtitleNode = (() => {
    if (hoveredBarEntry) {
      const prevValue =
        hoveredBar !== null && hoveredBar > 0 ? bars[hoveredBar - 1].value : 0;
      const diff = Math.max(0, hoveredBarEntry.value - prevValue);
      return (
        <>
          <span style={{ color: "#34C759" }}>{formatEarningsAmount(diff)}</span>
          <span style={{ color: secondary }}>
            {" · "}
            {formatEarningsBarDate(hoveredBarEntry.endMs, rangeId)}
          </span>
        </>
      );
    }
    const first = bars[0]?.value ?? 0;
    const delta = Math.max(0, liveTotal - first);
    return (
      <span style={{ color: "#34C759" }}>
        {formatEarningsAmount(delta)} {range.rangeSubtitle}
      </span>
    );
  })();

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px",
        width: "100%",
      }}
    >
      <style jsx>{`
        :global(.earnings-current-flow) {
          --number-flow-mask-height: 0.12em;
          --number-flow-mask-width: 0.24em;
          color: #000;
          font-family: ${font};
          font-size: 28px;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          line-height: 32px;
        }
        :global(.earnings-current-flow::part(decimal)),
        :global(.earnings-current-flow::part(fraction)) {
          color: rgba(60, 60, 67, 0.4);
        }
        .earnings-bar {
          background: rgba(0, 0, 0, 0.04);
          border: none;
          border-radius: 4px;
          flex: 1 0 0;
          min-width: 0;
          padding: 0;
          transform-origin: center bottom;
          animation: earnings-bar-rise 0.55s cubic-bezier(0.2, 0, 0, 1) both;
          animation-delay: calc(var(--bar-index, 0) * 14ms);
          transition: background 0.18s ease;
        }
        .earnings-bar:hover,
        .earnings-bar-active {
          background: #34c759;
        }
        @keyframes earnings-bar-rise {
          from {
            transform: scaleY(0);
            opacity: 0;
          }
          to {
            transform: scaleY(1);
            opacity: 1;
          }
        }
        .earnings-tab-panel {
          transition:
            opacity 0.34s cubic-bezier(0.2, 0, 0, 1),
            transform 0.34s cubic-bezier(0.2, 0, 0, 1),
            filter 0.34s cubic-bezier(0.2, 0, 0, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .earnings-bar {
            animation: none;
          }
          .earnings-tab-panel {
            transition: none;
          }
        }
        .earnings-range-chip {
          background: transparent;
          border: none;
          border-radius: 9999px;
          color: ${secondary};
          cursor: pointer;
          font-family: ${font};
          font-size: 14px;
          font-weight: 500;
          line-height: 20px;
          padding: 6px 12px;
          transition: background 0.15s ease;
        }
        .earnings-range-chip:hover:not(.earnings-range-chip-active) {
          background: rgba(0, 0, 0, 0.04);
        }
        .earnings-range-chip-active {
          background: rgba(0, 0, 0, 0.04);
          color: #000;
        }
      `}</style>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: "8px",
          justifyContent: "space-between",
          padding: "0 12px 8px",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            gap: "8px",
            minWidth: 0,
          }}
        >
          {(["Earnings", "Forecast"] as const).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                style={{
                  background: isActive ? "#F5F5F5" : "transparent",
                  border: "none",
                  borderRadius: "9999px",
                  color: isActive ? "#000" : secondary,
                  cursor: "pointer",
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  padding: "6px 12px",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateAreas: '"panel"',
          position: "relative",
          width: "100%",
        }}
      >
        <div
          aria-hidden={activeTab !== "Forecast"}
          className="earnings-tab-panel"
          key={`forecast-${forecastRevision}`}
          style={{
            filter: activeTab === "Forecast" ? "blur(0)" : "blur(2px)",
            gridArea: "panel",
            opacity: activeTab === "Forecast" ? 1 : 0,
            pointerEvents: activeTab === "Forecast" ? "auto" : "none",
            transform:
              activeTab === "Forecast"
                ? "translateY(0) scale(1)"
                : "translateY(6px) scale(0.985)",
          }}
        >
          <div style={{ padding: "12px", width: "100%" }}>
            <DepositChart
              apy={apy}
              key={forecastAmount}
              principal={forecastAmount}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                overflow: "hidden",
                paddingTop: "8px",
                width: "100%",
              }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: "2px" }}
              >
                <span
                  style={{
                    color: secondary,
                    fontFamily: font,
                    fontSize: "13px",
                    lineHeight: "16px",
                  }}
                >
                  {FORECAST_DATES[0]}
                </span>
                <span
                  style={{
                    color: "#000",
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 500,
                    lineHeight: "20px",
                  }}
                >
                  {formatForecastMoney(forecastAmount, true)}
                </span>
              </div>
              <div
                style={{
                  alignItems: "flex-end",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                }}
              >
                <span
                  style={{
                    color: secondary,
                    fontFamily: font,
                    fontSize: "13px",
                    lineHeight: "16px",
                  }}
                >
                  {FORECAST_DATES[FORECAST_DATES.length - 1]}
                </span>
                <span
                  style={{
                    alignItems: "center",
                    color: "#34C759",
                    display: "flex",
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 500,
                    gap: "4px",
                    lineHeight: "20px",
                  }}
                >
                  {formatForecastMoney(
                    forecastAmount *
                      getEarnForecastTargetMultiplier(apy.apyBps)
                  )}
                  <span
                    style={{
                      alignItems: "center",
                      background: "#34C759",
                      borderRadius: "4px",
                      display: "inline-flex",
                      height: "16px",
                      justifyContent: "center",
                      width: "16px",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      aria-hidden="true"
                      src="/wallet-workspace/earn-growth-arrow.svg"
                      style={{ height: "12px", width: "12px" }}
                    />
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
        <div
          aria-hidden={activeTab !== "Earnings"}
          className="earnings-tab-panel"
          key={`earnings-${earningsRevision}`}
          style={{
            filter: activeTab === "Earnings" ? "blur(0)" : "blur(2px)",
            gridArea: "panel",
            opacity: activeTab === "Earnings" ? 1 : 0,
            pointerEvents: activeTab === "Earnings" ? "auto" : "none",
            transform:
              activeTab === "Earnings"
                ? "translateY(0) scale(1)"
                : "translateY(6px) scale(0.985)",
          }}
        >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "2px 14px",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "flex-end",
            display: "flex",
            gap: "8px",
            justifyContent: "space-between",
            paddingBottom: "8px",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
            }}
          >
            <NumberFlow
              animated={hoveredBar === null}
              className="earnings-current-flow"
              format={{
                maximumFractionDigits: EARN_BALANCE_DECIMALS,
                minimumFractionDigits: EARN_BALANCE_DECIMALS,
                useGrouping: true,
              }}
              opacityTiming={{ duration: 280, easing: "ease-out" }}
              plugins={EARN_NUMBER_FLOW_PLUGINS}
              prefix="$"
              spinTiming={{
                duration: 900,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
              }}
              transformTiming={{
                duration: 900,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
              }}
              trend={1}
              value={Number(displayValue.toFixed(EARN_BALANCE_DECIMALS))}
            />
            <span
              style={{
                fontFamily: font,
                fontSize: "13px",
                lineHeight: "16px",
              }}
            >
              {subtitleNode}
            </span>
          </div>
          <span
            style={{
              color: secondary,
              flexShrink: 0,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
              paddingBottom: "2px",
            }}
          >
            ${maxValue.toFixed(2)}
          </span>
        </div>

        <div
          key={`earnings-bars-${rangeId}`}
          onMouseLeave={() => setHoveredBar(null)}
          style={{
            alignItems: "flex-end",
            display: "flex",
            gap: "8px",
            height: `${EARNINGS_CHART_HEIGHT}px`,
            overflow: "hidden",
            width: "100%",
          }}
        >
          {bars.map((bar, i) => {
            const heightPct = (bar.value / maxValue) * 100;
            const isActive = hoveredBar === i;
            const minHeightPx = 4;
            return (
              <button
                aria-label={`Bar ${i + 1}`}
                className={`earnings-bar${
                  isActive ? " earnings-bar-active" : ""
                }`}
                key={i}
                onMouseEnter={() => setHoveredBar(i)}
                style={{
                  height: `max(${minHeightPx}px, ${heightPct.toFixed(2)}%)`,
                  ["--bar-index" as never]: i,
                }}
                type="button"
              />
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          padding: "8px 12px 0",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            gap: "8px",
            minWidth: 0,
          }}
        >
          {EARNINGS_RANGES.map((r) => (
            <button
              className={`earnings-range-chip${
                r.id === rangeId ? " earnings-range-chip-active" : ""
              }`}
              key={r.id}
              onClick={() => {
                setRangeId(r.id);
                setHoveredBar(null);
              }}
              type="button"
            >
              {r.label}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            justifyContent: "flex-end",
            minWidth: 0,
            paddingLeft: "12px",
          }}
        >
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
              whiteSpace: "nowrap",
            }}
          >
            $0.00
          </span>
        </div>
      </div>
        </div>
      </div>
    </section>
  );
}

export function EarnDetailView({
  hasCurrentPosition = false,
  onDeposit,
  onWithdraw,
}: {
  hasCurrentPosition?: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}) {
  const earnForecastApy = useEarnForecastApy();
  const earnApyLabel = formatEarnApyLabel(earnForecastApy.apyBps);

  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 20px 0",
        }}
      >
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            transform: "translateY(-5px)",
            whiteSpace: "nowrap",
          }}
        >
          Earn
        </h2>
        {hasCurrentPosition ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <PositionHeaderButton
              icon="withdraw"
              iconColor="#85868A"
              label="Withdraw"
              onClick={onWithdraw}
            />
            <PositionHeaderButton
              dark
              icon="deposit"
              label="Deposit"
              onClick={onDeposit}
            />
          </div>
        ) : (
          <DepositButton dark onClick={onDeposit} withIcon />
        )}
      </div>

      <div
        style={{
          alignItems: "center",
          borderRadius: "20px",
          display: "flex",
          overflow: "hidden",
          padding: "0 20px 8px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", padding: "0 12px 8px 0" }}>
          <EarnYieldIcon />
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "2px",
            minWidth: 0,
            padding: "0 0 8px",
          }}
        >
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "20px",
            }}
          >
            {hasCurrentPosition ? (
              <>
                Balance · <span style={{ color: "#34C759" }}>{earnApyLabel}</span>
              </>
            ) : (
              "Balance"
            )}
          </span>
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "40px",
              fontWeight: 600,
              lineHeight: "48px",
              whiteSpace: "nowrap",
            }}
          >
            {hasCurrentPosition ? (
              <EarnGrowingBalance apyBps={earnForecastApy.apyBps} />
            ) : (
              <>
                $0
                <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
              </>
            )}
          </span>
        </div>
      </div>

      {hasCurrentPosition ? <div style={{ height: "9px" }} /> : null}

      {hasCurrentPosition ? <EarningsBlock apy={earnForecastApy} /> : null}

      {hasCurrentPosition ? (
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
          <div style={{ padding: "3px 12px 1px" }}>
            <h3
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 600,
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 8px",
              }}
            >
              Current positions
            </h3>
          </div>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              minHeight: "60px",
              overflow: "hidden",
              padding: "0 12px",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
              <VaultIcon logo={TOP_EARN_VAULT.logo} />
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: "2px",
                justifyContent: "center",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  lineHeight: "16px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {TOP_EARN_VAULT.label}
              </span>
              <div>
                <ApyBadge value={earnApyLabel} />
              </div>
            </div>
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                lineHeight: "20px",
                marginLeft: "12px",
                whiteSpace: "nowrap",
              }}
            >
              $1,000
              <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PositionHeaderButton({
  dark = false,
  icon,
  iconColor,
  label,
  onClick,
}: {
  dark?: boolean;
  icon: "deposit" | "withdraw";
  iconColor?: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <>
      <style jsx>{`
        .earn-position-action {
          transition:
            background 0.15s ease,
            transform 0.15s ease;
        }
        .earn-position-action:hover {
          transform: translateY(-1px);
        }
        .earn-position-action:active {
          transform: translateY(0);
        }
      `}</style>
      <button
        className="earn-position-action"
        onClick={onClick}
        style={{
          alignItems: "center",
          background: dark ? "#000" : "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: dark ? "#fff" : "#000",
          cursor: "pointer",
          display: "inline-flex",
          flexShrink: 0,
          fontFamily: font,
          fontSize: "14px",
          fontWeight: 500,
          gap: "8px",
          height: "36px",
          lineHeight: "20px",
          padding: "6px 16px 6px 8px",
          whiteSpace: "nowrap",
        }}
        type="button"
      >
        <span
          style={{
            alignItems: "center",
            display: "inline-flex",
            height: "24px",
            justifyContent: "center",
            width: "24px",
          }}
        >
          {icon === "withdraw" ? (
            <ArrowUp color={iconColor} size={24} strokeWidth={2} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              aria-hidden="true"
              src="/wallet-workspace/earn-plus.svg"
              style={{ height: "16px", width: "16px" }}
            />
          )}
        </span>
        {label}
      </button>
    </>
  );
}


function WithdrawRouteRow({
  amount,
  icon,
  isDropdown = false,
  isOpen = false,
  isPosition = false,
  isSelected = false,
  onClick,
  subtitle,
}: {
  amount: string;
  icon: string;
  isDropdown?: boolean;
  isOpen?: boolean;
  isPosition?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  subtitle: string;
}) {
  const [wholeAmount, fractionAmount = "00"] = amount.split(".");

  return (
    <button
      className={onClick ? "earn-withdraw-route" : undefined}
      onClick={onClick}
      style={{
        alignItems: "center",
        background: isOpen ? "rgba(0, 0, 0, 0.04)" : "transparent",
        border: "none",
        borderRadius: isDropdown ? "16px" : "8px",
        cursor: onClick ? "pointer" : "default",
        display: "flex",
        minHeight: "60px",
        overflow: "hidden",
        padding: "0 12px",
        textAlign: "left",
        transition: "background 0.15s ease",
        width: "100%",
      }}
      type="button"
    >
      <style jsx>{`
        .earn-withdraw-route:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
      `}</style>
      <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
        {isPosition ? (
          <VaultIcon logo={icon} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            aria-hidden="true"
            src={icon}
            style={{
              borderRadius: "12px",
              height: "48px",
              objectFit: "cover",
              width: "48px",
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "2px",
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: secondary,
            fontFamily: font,
            fontSize: "13px",
            lineHeight: "16px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </span>
        <span
          style={{
            color: "#000",
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "24px",
            whiteSpace: "nowrap",
          }}
        >
          {wholeAmount}
          <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>
            .{fractionAmount} USDC
          </span>
        </span>
      </div>
      {isDropdown ? (
        <span
          aria-hidden="true"
          style={{
            display: "flex",
            marginLeft: "12px",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        >
          {isOpen ? (
            <ChevronsDownUp color="#B1B1B4" size={24} strokeWidth={2} />
          ) : (
            <ChevronsUpDown color="#B1B1B4" size={24} strokeWidth={2} />
          )}
        </span>
      ) : isSelected ? (
        <Check
          color="#F9363C"
          size={24}
          strokeWidth={2}
          style={{ marginLeft: "12px" }}
        />
      ) : null}
    </button>
  );
}

export function EarnWithdrawView({
  onClose,
  onComplete,
  destinations = FALLBACK_EARN_DEPOSIT_SOURCES,
}: {
  onClose?: () => void;
  onComplete?: () => void;
  destinations?: EarnDepositSourceOption[];
}) {
  const withdrawAmountInputRef = useRef<HTMLInputElement | null>(null);
  const withdrawDestCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawDestMenuOpen, setIsWithdrawDestMenuOpen] = useState(false);
  const [isWithdrawDestMenuClosing, setIsWithdrawDestMenuClosing] =
    useState(false);
  const destinationOptions =
    destinations.length > 0 ? destinations : FALLBACK_EARN_DEPOSIT_SOURCES;
  const [selectedDestinationId, setSelectedDestinationId] = useState(
    destinationOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
  );
  const selectedDestination =
    destinationOptions.find((dest) => dest.id === selectedDestinationId) ??
    destinationOptions[0] ??
    FALLBACK_EARN_DEPOSIT_SOURCES[0];
  const hasWithdrawAmount = withdrawAmount.length > 0;
  const withdrawUsdDisplay = hasWithdrawAmount
    ? `$${withdrawAmount}${withdrawAmount.includes(".") ? "" : ".00"}`
    : "$0.00";
  const shouldShowWithdrawDestMenu =
    isWithdrawDestMenuOpen || isWithdrawDestMenuClosing;

  const closeWithdrawDestMenu = () => {
    if (!isWithdrawDestMenuOpen || isWithdrawDestMenuClosing) return;
    setIsWithdrawDestMenuClosing(true);
    withdrawDestCloseTimerRef.current = setTimeout(() => {
      setIsWithdrawDestMenuOpen(false);
      setIsWithdrawDestMenuClosing(false);
      withdrawDestCloseTimerRef.current = null;
    }, 180);
  };

  const openWithdrawDestMenu = () => {
    if (withdrawDestCloseTimerRef.current) {
      clearTimeout(withdrawDestCloseTimerRef.current);
      withdrawDestCloseTimerRef.current = null;
    }
    setIsWithdrawDestMenuClosing(false);
    setIsWithdrawDestMenuOpen(true);
  };

  const toggleWithdrawDestMenu = () => {
    if (isWithdrawDestMenuClosing) {
      openWithdrawDestMenu();
      return;
    }
    if (isWithdrawDestMenuOpen) {
      closeWithdrawDestMenu();
      return;
    }
    openWithdrawDestMenu();
  };

  const handleDestinationSelect = (destinationId: string) => {
    setSelectedDestinationId(destinationId);
    closeWithdrawDestMenu();
  };

  useEffect(() => {
    if (!destinationOptions.some((dest) => dest.id === selectedDestinationId)) {
      setSelectedDestinationId(
        destinationOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
      );
    }
  }, [destinationOptions, selectedDestinationId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      withdrawAmountInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (withdrawDestCloseTimerRef.current) {
        clearTimeout(withdrawDestCloseTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <style jsx>{`
        .earn-withdraw-chip:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .earn-withdraw-submit:hover {
          background: #222 !important;
        }
        .earn-withdraw-submit:disabled:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-withdraw-amount-input::selection {
          background: rgba(249, 54, 60, 0.18);
        }
        .earn-withdraw-amount-input::placeholder {
          color: rgba(60, 60, 67, 0.4);
          opacity: 1;
        }
        .earn-withdraw-source-sheet {
          animation: earn-withdraw-source-sheet-open 0.18s ease forwards;
          transform-origin: top center;
        }
        .earn-withdraw-source-sheet-closing {
          animation: earn-withdraw-source-sheet-close 0.18s ease forwards;
          pointer-events: none;
        }
        @keyframes earn-withdraw-source-sheet-open {
          0% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes earn-withdraw-source-sheet-close {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
        }
      `}</style>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 20px 8px",
        }}
      >
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
          }}
        >
          Withdraw
        </h2>
        <CloseButton iconColor="#85868A" onClick={onClose} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          width: "100%",
        }}
      >
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "30px 20px 8px",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div
              style={{
                alignItems: "baseline",
                display: "flex",
                gap: "8px",
                minWidth: 0,
              }}
            >
              <input
                className="earn-withdraw-amount-input"
                inputMode="decimal"
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "" || /^[\d,]*\.?\d*$/.test(value)) {
                    setWithdrawAmount(value);
                  }
                }}
                placeholder="0"
                ref={withdrawAmountInputRef}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#000",
                  flexShrink: 1,
                  fontFamily: font,
                  fontSize: "40px",
                  fontWeight: 600,
                  lineHeight: "48px",
                  minWidth: 0,
                  outline: "none",
                  padding: 0,
                  width: `${Math.max(withdrawAmount.length, 1)}ch`,
                }}
                type="text"
                value={withdrawAmount}
              />
              <span
                style={{
                  color: "rgba(60, 60, 67, 0.4)",
                  fontFamily: font,
                  fontSize: "28px",
                  fontWeight: 600,
                  lineHeight: "32px",
                }}
              >
                USDC
              </span>
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                className="earn-withdraw-chip"
                style={{
                  background: "rgba(0, 0, 0, 0.04)",
                  border: "none",
                  borderRadius: "9999px",
                  color: "#000",
                  cursor: "pointer",
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  padding: "6px 16px",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                Earnings
              </button>
              <button
                className="earn-withdraw-submit"
                onClick={() => setWithdrawAmount("1,280")}
                style={{
                  background: "#000",
                  border: "none",
                  borderRadius: "9999px",
                  color: "#fff",
                  cursor: "pointer",
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  padding: "6px 16px",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                MAX
              </button>
            </div>
          </div>
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "16px",
              lineHeight: "22px",
              paddingTop: "4px",
            }}
          >
            {withdrawUsdDisplay}
          </span>
        </section>

        <section style={{ padding: "8px", position: "relative", width: "100%", zIndex: 2 }}>
          <div style={{ padding: "3px 12px 1px" }}>
            <p
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "16px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              From
            </p>
          </div>
          <WithdrawRouteRow
            amount="1,280.00"
            icon={TOP_EARN_VAULT.logo}
            isPosition
            subtitle={TOP_EARN_VAULT.label}
          />
          <div style={{ padding: "3px 12px 1px" }}>
            <p
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "16px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              To
            </p>
          </div>
          <WithdrawRouteRow
            amount={`${selectedDestination.balanceWhole}.${selectedDestination.balanceFraction}`}
            icon={selectedDestination.icon}
            isDropdown
            isOpen={isWithdrawDestMenuOpen}
            onClick={toggleWithdrawDestMenu}
            subtitle={`${selectedDestination.label} · ${selectedDestination.addressLabel}`}
          />
          {shouldShowWithdrawDestMenu ? (
            <div
              className={`earn-withdraw-source-sheet ${
                isWithdrawDestMenuClosing
                  ? "earn-withdraw-source-sheet-closing"
                  : ""
              }`}
              style={{
                backdropFilter: "blur(16px)",
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "16px",
                boxShadow:
                  "0 0 2px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.08)",
                display: "flex",
                flexDirection: "column",
                left: "8px",
                overflow: "hidden",
                padding: "8px",
                position: "absolute",
                right: "8px",
                top: "232px",
                WebkitBackdropFilter: "blur(16px)",
                zIndex: 4,
              }}
            >
              {destinationOptions.map((dest) => (
                <WithdrawRouteRow
                  amount={`${dest.balanceWhole}.${dest.balanceFraction}`}
                  icon={dest.icon}
                  isSelected={dest.id === selectedDestination.id}
                  key={dest.id}
                  onClick={() => handleDestinationSelect(dest.id)}
                  subtitle={`${dest.label} · ${dest.addressLabel}`}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <div
        style={{
          background: "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
          padding: "16px 32px 24px",
          width: "100%",
        }}
      >
        <button
          className="earn-withdraw-submit"
          disabled={!hasWithdrawAmount}
          onClick={onComplete}
          style={{
            alignItems: "center",
            background: hasWithdrawAmount ? "#000" : "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "78px",
            color: hasWithdrawAmount ? "#fff" : secondary,
            cursor: hasWithdrawAmount ? "pointer" : "default",
            display: "flex",
            fontFamily: font,
            fontSize: "17px",
            fontWeight: 500,
            height: "50px",
            justifyContent: "center",
            lineHeight: "22px",
            padding: "15px 12px",
            transition: "background 0.15s ease",
            width: "100%",
          }}
          type="button"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}

function CloseButton({
  iconColor,
  onClick,
}: {
  iconColor?: string;
  onClick?: () => void;
}) {
  return (
    <>
      <style jsx>{`
        .earn-deposit-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>
      <button
        className="earn-deposit-close"
        onClick={onClick}
        style={{
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: "#3C3C43",
          cursor: "pointer",
          display: "inline-flex",
          height: "36px",
          justifyContent: "center",
          padding: "6px",
          transition: "background 0.15s ease",
          width: "36px",
        }}
        type="button"
      >
        <X color={iconColor} size={24} strokeWidth={2} />
      </button>
    </>
  );
}

function DepositVaultIcon({ logo }: { logo: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flexShrink: 0,
        height: "48px",
        position: "relative",
        width: "48px",
      }}
    >
      <span
        style={{
          border: "2.286px solid #fff",
          borderRadius: "80px",
          height: "32px",
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-deposit-usdc.png"
          style={{ height: "100%", objectFit: "cover", width: "100%" }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-deposit-usdc-overlay.png"
          style={{ height: "100%", inset: 0, objectFit: "cover", position: "absolute", width: "100%" }}
        />
      </span>
      <span
        style={{
          borderRadius: "80px",
          bottom: 0,
          height: "32px",
          overflow: "hidden",
          position: "absolute",
          right: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={logo}
          style={{ height: "100%", objectFit: "cover", width: "100%" }}
        />
      </span>
    </span>
  );
}

function DepositVaultRow({
  apyLabel,
  vault,
}: {
  apyLabel: string;
  vault: { label: string; logo: string };
}) {
  return (
    <div
      style={{
        alignItems: "center",
        background: "transparent",
        borderRadius: "8px",
        display: "flex",
        minHeight: "60px",
        overflow: "hidden",
        padding: "0 12px",
        textAlign: "left",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
        <DepositVaultIcon logo={vault.logo} />
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "2px",
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: secondary,
            fontFamily: font,
            fontSize: "13px",
            lineHeight: "16px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {vault.label}
        </span>
        <div>
          <ApyBadge value={apyLabel} />
        </div>
      </div>
    </div>
  );
}

function DepositSourceRow({
  isHighlighted = false,
  isOpen = false,
  isSelected = false,
  isTrigger = false,
  onClick,
  source,
}: {
  isHighlighted?: boolean;
  isOpen?: boolean;
  isSelected?: boolean;
  isTrigger?: boolean;
  onClick?: () => void;
  source: EarnDepositSourceOption;
}) {
  return (
    <>
      <style jsx>{`
        .earn-source-trigger,
        .earn-source-option {
          transition:
            background 0.15s ease,
            transform 0.18s ease;
        }
        .earn-source-trigger:hover,
        .earn-source-option:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-source-chevron {
          transition: transform 0.18s ease;
        }
        .earn-source-check {
          animation: earn-source-check-in 0.18s ease;
        }
        @keyframes earn-source-check-in {
          0% {
            opacity: 0;
            transform: scale(0.82);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
      <button
        className={isTrigger ? "earn-source-trigger" : "earn-source-option"}
        onClick={onClick}
        style={{
          alignItems: "center",
          background: isTrigger
            ? isOpen
              ? "rgba(0, 0, 0, 0.04)"
              : "transparent"
            : isHighlighted
              ? "rgba(0, 0, 0, 0.04)"
              : "transparent",
          border: "none",
          borderRadius: isTrigger ? "16px" : "8px",
          cursor: onClick ? "pointer" : "default",
          display: "flex",
          minHeight: "60px",
          overflow: "hidden",
          padding: "0 12px",
          textAlign: "left",
          width: "100%",
        }}
        type="button"
      >
        <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            src={source.icon}
            style={{
              borderRadius: "12px",
              height: "48px",
              objectFit: "cover",
              width: "48px",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "2px",
            height: "60px",
            justifyContent: "center",
            minWidth: 0,
            padding: "9px 0",
          }}
        >
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {source.label} · {source.addressLabel}
          </span>
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "24px",
              whiteSpace: "nowrap",
            }}
          >
            {source.balanceWhole}
            <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>
              .{source.balanceFraction} USDC
            </span>
          </span>
        </div>
        {isTrigger ? (
          <span
            aria-hidden="true"
            className="earn-source-chevron"
            style={{
              display: "flex",
              marginLeft: "12px",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            {isOpen ? (
              <ChevronsDownUp
                color="#B1B1B4"
                size={24}
                strokeWidth={2}
              />
            ) : (
              <ChevronsUpDown
                color="#B1B1B4"
                size={24}
                strokeWidth={2}
              />
            )}
          </span>
        ) : isSelected ? (
          <Check
            className="earn-source-check"
            color="#F9363C"
            size={24}
            strokeWidth={2}
            style={{ marginLeft: "12px" }}
          />
        ) : null}
      </button>
    </>
  );
}

function DepositChart({
  apy = FALLBACK_EARN_APY,
  principal = 1000,
}: {
  apy?: EarnForecastApy;
  principal?: number;
}) {
  const points = useMemo(() => buildEarnChartPoints(principal, apy), [
    apy,
    principal,
  ]);
  const defaultHoverIndex = Math.floor((points.length - 1) / 2);
  const [hoverIndex, setHoverIndex] = useState(defaultHoverIndex);
  const minValue = principal;
  const maxValue =
    principal * getEarnForecastTargetMultiplier(apy.rangeHighBps);
  const chartHeight = EARN_CHART_BASELINE - EARN_CHART_TOP;
  const plot = (value: number) =>
    EARN_CHART_BASELINE -
    ((value - minValue) / (maxValue - minValue)) * chartHeight;
  const xForIndex = (index: number) =>
    (index / (points.length - 1)) * EARN_CHART_WIDTH;
  const plotted = points.map((point) => ({
    ...point,
    highY: plot(point.highValue),
    lowY: plot(point.lowValue),
    x: xForIndex(point.index),
    y: plot(point.value),
  }));
  const pathFrom = (key: "highY" | "lowY" | "y") =>
    plotted
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point[key]}`)
      .join(" ");
  const areaPath = [
    `M${plotted[0]?.x ?? 0},${EARN_CHART_BASELINE}`,
    ...plotted.map((point) => `L${point.x},${point.y}`),
    `L${EARN_CHART_WIDTH},${EARN_CHART_BASELINE}`,
    "Z",
  ].join(" ");
  const hoverPoint = plotted[Math.min(hoverIndex, plotted.length - 1)];
  const hoverLeft = (hoverPoint.x / EARN_CHART_WIDTH) * 100;
  const tooltipLeft = Math.min(Math.max(hoverLeft, 21), 79);
  const pointTop = (value: number) => (value / EARN_CHART_HEIGHT) * 100;

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const nextIndex = Math.round((x / rect.width) * (points.length - 1));
    setHoverIndex(nextIndex);
  };

  return (
    <div
      onPointerLeave={() => setHoverIndex(defaultHoverIndex)}
      onPointerMove={handlePointerMove}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        height: "300px",
        justifyContent: "center",
        padding: "2px 0",
        position: "relative",
        width: "100%",
      }}
    >
      <style jsx>{`
        .earn-chart-reveal-rect {
          animation: earn-chart-reveal 0.7s cubic-bezier(0.2, 0, 0, 1) both;
          transform-origin: 0 0;
        }
        .earn-chart-hover-elements {
          animation: earn-chart-hover-fade 0.25s 0.5s ease both;
        }
        @keyframes earn-chart-reveal {
          0% {
            transform: scaleX(0);
          }
          100% {
            transform: scaleX(1);
          }
        }
        @keyframes earn-chart-hover-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .earn-chart-reveal-rect,
          .earn-chart-hover-elements {
            animation: none;
          }
        }
      `}</style>
      <div style={{ flex: 1, minHeight: 0, position: "relative", width: "100%" }}>
        <svg
          aria-label="Estimated earnings chart"
          preserveAspectRatio="none"
          role="img"
          style={{ display: "block", height: "100%", width: "100%" }}
          viewBox={`0 0 ${EARN_CHART_WIDTH} ${EARN_CHART_HEIGHT}`}
        >
          <defs>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id="earn-chart-area"
              x1="254"
              x2="254"
              y1="0"
              y2={EARN_CHART_BASELINE}
            >
              <stop stopColor="#34C759" stopOpacity="0.28" />
              <stop offset="1" stopColor="#34C759" stopOpacity="0" />
            </linearGradient>
            <clipPath
              clipPathUnits="userSpaceOnUse"
              id="earn-chart-reveal-clip"
            >
              <rect
                className="earn-chart-reveal-rect"
                height={EARN_CHART_HEIGHT}
                width={EARN_CHART_WIDTH}
                x={0}
                y={0}
              />
            </clipPath>
          </defs>
          <g clipPath="url(#earn-chart-reveal-clip)">
            <path d={areaPath} fill="url(#earn-chart-area)" />
            <path
              d={pathFrom("highY")}
              fill="none"
              stroke="#A7E2BC"
              strokeDasharray="6 6"
              strokeLinecap="round"
            />
            <path
              d={pathFrom("lowY")}
              fill="none"
              stroke="#A7E2BC"
              strokeDasharray="6 6"
              strokeLinecap="round"
            />
            <path
              d={pathFrom("y")}
              fill="none"
              stroke="#34C759"
              strokeLinecap="round"
              strokeWidth="2"
            />
            <rect
              fill="#fff"
              fillOpacity="0.7"
              height={EARN_CHART_HEIGHT}
              width={Math.max(EARN_CHART_WIDTH - hoverPoint.x, 0)}
              x={hoverPoint.x}
              y={0}
            />
          </g>
        </svg>
        <div
          aria-hidden="true"
          className="earn-chart-hover-elements"
          style={{
            borderLeft: "1px dashed rgba(60, 60, 67, 0.18)",
            bottom: `${((EARN_CHART_HEIGHT - EARN_CHART_BASELINE) / EARN_CHART_HEIGHT) * 100}%`,
            left: `${hoverLeft}%`,
            pointerEvents: "none",
            position: "absolute",
            top: `${(EARN_CHART_TOP / EARN_CHART_HEIGHT) * 100}%`,
          }}
        />
        {[
          { color: "#A7E2BC", top: pointTop(hoverPoint.highY) },
          { color: "#34C759", top: pointTop(hoverPoint.y) },
          { color: "#A7E2BC", top: pointTop(hoverPoint.lowY) },
        ].map((dot) => (
          <span
            aria-hidden="true"
            className="earn-chart-hover-elements"
            key={`${dot.color}-${dot.top}`}
            style={{
              background: dot.color,
              borderRadius: "9999px",
              height: "8px",
              left: `${hoverLeft}%`,
              pointerEvents: "none",
              position: "absolute",
              top: `${dot.top}%`,
              transform: "translate(-50%, -50%)",
              width: "8px",
            }}
          />
        ))}
        <div
          className="earn-chart-hover-elements"
          style={{
            background: "#F5F5F5",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            left: `${tooltipLeft}%`,
            overflow: "hidden",
            padding: "8px 12px",
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            transform: "translateX(-50%)",
            width: "200px",
          }}
        >
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "24px",
            }}
          >
            ${formatMoney(hoverPoint.value).split(".")[0]}
            <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>
              .{formatMoney(hoverPoint.value).split(".")[1]}
            </span>
          </span>
          <span
            style={{
              color: secondary,
              display: "flex",
              flexDirection: "column",
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
            }}
          >
            <span>{hoverPoint.date}</span>
            <span>
              <span style={{ color: "#000" }}>
                +{formatMoney(hoverPoint.yieldUsd)} USDC{" "}
              </span>
              yield
            </span>
            <span>with {formatEarnApyPercent(apy.apyBps)} simulated APY</span>
            <span>
              Range: {formatEarnApyPercent(apy.rangeLowBps)} –{" "}
              {formatEarnApyPercent(apy.rangeHighBps)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function EarnDepositView({
  onComplete,
  onClose,
  onDraftChange,
  sources = FALLBACK_EARN_DEPOSIT_SOURCES,
}: {
  onComplete?: (deposit: EarnDepositCompletion) => void;
  onClose?: () => void;
  onDraftChange?: (draft: EarnDepositDraft | null) => void;
  sources?: EarnDepositSourceOption[];
}) {
  const earnForecastApy = useEarnForecastApy();
  const earnApyLabel = formatEarnApyLabel(earnForecastApy.apyBps);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [forecastAmount, setForecastAmount] = useState<number>(
    FORECAST_AMOUNT_PRESETS[2].value
  );
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [isSourceMenuClosing, setIsSourceMenuClosing] = useState(false);
  const sourceCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const sourceOptions =
    sources.length > 0 ? sources : FALLBACK_EARN_DEPOSIT_SOURCES;
  const [selectedSourceId, setSelectedSourceId] = useState(
    sourceOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
  );
  const selectedSource =
    sourceOptions.find((source) => source.id === selectedSourceId) ??
    sourceOptions[0] ??
    FALLBACK_EARN_DEPOSIT_SOURCES[0];
  const selectedSourceBalance = selectedSource.balance;
  const numericDepositAmount =
    Number.parseFloat(depositAmount.replace(/,/g, "")) || 0;
  const hasDepositAmount = depositAmount.length > 0;
  const depositUsdDisplay = hasDepositAmount
    ? `$${depositAmount}${depositAmount.includes(".") ? "" : ".00"}`
    : "$0.00";
  const amountError =
    hasDepositAmount && numericDepositAmount < MIN_DEPOSIT_USDC
      ? `Minimum deposit is ${MIN_DEPOSIT_USDC} USDC`
      : hasDepositAmount && numericDepositAmount > selectedSourceBalance
        ? "Insufficient balance"
        : null;
  const isDepositButtonDisabled = !hasDepositAmount || amountError !== null;
  const shouldShowSourceMenu = isSourceMenuOpen || isSourceMenuClosing;
  const openSourceMenu = () => {
    if (sourceCloseTimerRef.current) {
      clearTimeout(sourceCloseTimerRef.current);
      sourceCloseTimerRef.current = null;
    }
    setIsSourceMenuClosing(false);
    setIsSourceMenuOpen(true);
  };
  const closeSourceMenu = () => {
    if (!isSourceMenuOpen || isSourceMenuClosing) return;
    setIsSourceMenuClosing(true);
    sourceCloseTimerRef.current = setTimeout(() => {
      setIsSourceMenuOpen(false);
      setIsSourceMenuClosing(false);
      sourceCloseTimerRef.current = null;
    }, 180);
  };
  const toggleSourceMenu = () => {
    if (isSourceMenuClosing) {
      openSourceMenu();
      return;
    }
    if (isSourceMenuOpen) {
      closeSourceMenu();
      return;
    }
    openSourceMenu();
  };
  const handleSourceSelect = (sourceId: string) => {
    const nextSource =
      sourceOptions.find((source) => source.id === sourceId) ?? selectedSource;
    const clampedAmount = clampDepositAmountInput(
      depositAmount,
      nextSource.balance
    );

    setSelectedSourceId(sourceId);
    if (clampedAmount !== null && clampedAmount !== depositAmount) {
      setDepositAmount(clampedAmount);
      scheduleForecastFromInput(clampedAmount);
    }
    closeSourceMenu();
  };

  const forecastDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const cancelForecastDebounce = () => {
    if (forecastDebounceRef.current) {
      clearTimeout(forecastDebounceRef.current);
      forecastDebounceRef.current = null;
    }
  };
  const scheduleForecastFromInput = (rawValue: string) => {
    cancelForecastDebounce();
    forecastDebounceRef.current = setTimeout(() => {
      const numeric = Number.parseFloat(rawValue.replace(/,/g, "")) || 0;
      setForecastAmount(
        numeric > 0 ? numeric : FORECAST_AMOUNT_PRESETS[2].value
      );
    }, 1000);
  };
  const handleChipClick = (value: number) => {
    cancelForecastDebounce();
    setForecastAmount(value);
  };

  useEffect(() => {
    return () => {
      if (sourceCloseTimerRef.current) {
        clearTimeout(sourceCloseTimerRef.current);
      }
      if (forecastDebounceRef.current) {
        clearTimeout(forecastDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasDepositAmount || amountError !== null) {
      onDraftChange?.(null);
      return;
    }

    onDraftChange?.({
      amount: numericDepositAmount,
      amountLabel: depositAmount,
      forecastApyBps: earnForecastApy.apyBps,
      source: selectedSource,
      symbol: "USDC",
      tokenDecimals: selectedSource.decimals,
      tokenMint: selectedSource.mint,
    });
  }, [
    amountError,
    depositAmount,
    earnForecastApy.apyBps,
    hasDepositAmount,
    numericDepositAmount,
    onDraftChange,
    selectedSource,
  ]);

  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);

  useEffect(() => {
    if (!sourceOptions.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(sourceOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id);
    }
  }, [selectedSourceId, sourceOptions]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      amountInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <style jsx>{`
        .earn-deposit-max:hover,
        .earn-deposit-submit:not(:disabled):hover {
          background: #222 !important;
        }
        .earn-deposit-amount-input::selection {
          background: rgba(249, 54, 60, 0.18);
        }
        .earn-deposit-amount-input::placeholder {
          color: rgba(60, 60, 67, 0.4);
          opacity: 1;
        }
        .earn-forecast-chip {
          transition:
            background 0.15s ease,
            color 0.15s ease;
        }
        .earn-forecast-chip:hover:not(.earn-forecast-chip-active) {
          background: rgba(0, 0, 0, 0.04);
        }
        .earn-source-sheet {
          animation: earn-source-sheet-open 0.18s ease forwards;
          transform-origin: top center;
        }
        .earn-source-sheet-closing {
          animation: earn-source-sheet-close 0.18s ease forwards;
          pointer-events: none;
        }
        @keyframes earn-source-sheet-open {
          0% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes earn-source-sheet-close {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
        }
      `}</style>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 20px 8px",
        }}
      >
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
          }}
        >
          Deposit
        </h2>
        <CloseButton onClick={onClose} />
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          width: "100%",
        }}
      >
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
          <DepositVaultRow
            apyLabel={earnApyLabel}
            vault={TOP_DEPOSIT_VAULT}
          />
        </section>

        <section style={{ display: "flex", flexDirection: "column", padding: "8px", width: "100%" }}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: "8px",
              justifyContent: "space-between",
              padding: "12px 12px 8px",
              width: "100%",
            }}
          >
            <p
              style={{
                color: secondary,
                flexShrink: 0,
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                margin: 0,
              }}
            >
              Estimated earnings
            </p>
            <div
              style={{
                display: "flex",
                flexShrink: 0,
                gap: "4px",
              }}
            >
              {FORECAST_AMOUNT_PRESETS.map((preset) => {
                const isActive = preset.value === forecastAmount;
                return (
                  <button
                    className={`earn-forecast-chip ${
                      isActive ? "earn-forecast-chip-active" : ""
                    }`}
                    key={preset.value}
                    onClick={() => handleChipClick(preset.value)}
                    style={{
                      background: isActive ? "#000" : "transparent",
                      border: "none",
                      borderRadius: "9999px",
                      color: isActive ? "#fff" : secondary,
                      cursor: "pointer",
                      fontFamily: font,
                      fontSize: "13px",
                      fontWeight: 500,
                      lineHeight: "16px",
                      padding: "4px 10px",
                    }}
                    type="button"
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ padding: "12px", width: "100%" }}>
            <DepositChart
              apy={earnForecastApy}
              key={forecastAmount}
              principal={forecastAmount}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                overflow: "hidden",
                paddingTop: "8px",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: secondary, fontFamily: font, fontSize: "13px", lineHeight: "16px" }}>
                  {FORECAST_DATES[0]}
                </span>
                <span style={{ color: "#000", fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px" }}>
                  {formatForecastMoney(forecastAmount, true)}
                </span>
              </div>
              <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: secondary, fontFamily: font, fontSize: "13px", lineHeight: "16px" }}>
                  {FORECAST_DATES[FORECAST_DATES.length - 1]}
                </span>
                <span style={{ alignItems: "center", color: "#34C759", display: "flex", fontFamily: font, fontSize: "16px", fontWeight: 500, gap: "4px", lineHeight: "20px" }}>
                  {formatForecastMoney(
                    forecastAmount *
                      getEarnForecastTargetMultiplier(earnForecastApy.apyBps)
                  )}
                  <span style={{ alignItems: "center", background: "#34C759", borderRadius: "4px", display: "inline-flex", height: "16px", justifyContent: "center", width: "16px" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" aria-hidden="true" src="/wallet-workspace/earn-growth-arrow.svg" style={{ height: "12px", width: "12px" }} />
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px 8px 0",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              padding: "8px 12px",
              width: "100%",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "4px",
                width: "100%",
              }}
            >
              <div
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  flex: 1,
                  gap: "8px",
                  minWidth: 0,
                }}
              >
                <input
                  className="earn-deposit-amount-input"
                  inputMode="decimal"
                  ref={amountInputRef}
                  onChange={(event) => {
                    const clampedValue = clampDepositAmountInput(
                      event.target.value,
                      selectedSource.balance
                    );
                    if (clampedValue !== null) {
                      setDepositAmount(clampedValue);
                      scheduleForecastFromInput(clampedValue);
                    }
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#000",
                    flexShrink: 1,
                    fontFamily: font,
                    fontSize: "40px",
                    fontWeight: 600,
                    lineHeight: "48px",
                    minWidth: 0,
                    outline: "none",
                    padding: 0,
                    width: `${Math.max(depositAmount.length, 1)}ch`,
                  }}
                  placeholder="0"
                  type="text"
                  value={depositAmount}
                />
                <span
                  style={{
                    color: "rgba(60, 60, 67, 0.4)",
                    fontFamily: font,
                    fontSize: "28px",
                    fontWeight: 600,
                    lineHeight: "32px",
                    whiteSpace: "nowrap",
                  }}
                >
                  USDC
                </span>
              </div>
              <button
                className="earn-deposit-max"
                onClick={() => {
                  const maxValue = formatDepositAmount(selectedSource.balance);
                  setDepositAmount(maxValue);
                  scheduleForecastFromInput(maxValue);
                }}
                style={{
                  background: "#000",
                  border: "none",
                  borderRadius: "9999px",
                  color: "#fff",
                  cursor: "pointer",
                  flexShrink: 0,
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  padding: "6px 16px",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                MAX
              </button>
            </div>
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
              }}
            >
              {depositUsdDisplay}
            </span>
          </div>
        </section>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            position: "relative",
            width: "100%",
            zIndex: 2,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <div style={{ padding: "3px 12px 1px" }}>
              <p
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  margin: 0,
                  padding: "12px 0 4px",
                }}
              >
                From
              </p>
            </div>
            <DepositSourceRow
              isOpen={isSourceMenuOpen}
              isTrigger
              onClick={toggleSourceMenu}
              source={selectedSource}
            />
            {shouldShowSourceMenu ? (
              <div
                className={`earn-source-sheet ${
                  isSourceMenuClosing ? "earn-source-sheet-closing" : ""
                }`}
                style={{
                  backdropFilter: "blur(16px)",
                  background: "rgba(255, 255, 255, 0.7)",
                  borderRadius: "16px",
                  boxShadow:
                    "0 0 2px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.08)",
                  display: "flex",
                  flexDirection: "column",
                  left: "8px",
                  overflow: "hidden",
                  padding: "8px",
                  position: "absolute",
                  right: "8px",
                  top: "44px",
                  WebkitBackdropFilter: "blur(16px)",
                  zIndex: 4,
                }}
              >
                {sourceOptions.map((source, index) => (
                  <DepositSourceRow
                    isHighlighted={
                      source.id !== selectedSource.id &&
                      index ===
                        Math.min(
                          sourceOptions.findIndex(
                            (option) => option.id === selectedSource.id
                          ) + 1,
                          sourceOptions.length - 1
                        )
                    }
                    isSelected={source.id === selectedSource.id}
                    key={source.id}
                    onClick={() => handleSourceSelect(source.id)}
                    source={source}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div
        style={{
          background: "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
          padding: "16px 32px 24px",
          width: "100%",
        }}
      >
        <button
          className="earn-deposit-submit"
          disabled={isDepositButtonDisabled}
          onClick={() =>
            onComplete?.({
              amount: numericDepositAmount,
              source: selectedSource,
            })
          }
          style={{
            alignItems: "center",
            background: amountError
              ? "rgba(249, 54, 60, 0.14)"
              : isDepositButtonDisabled
                ? "rgba(0, 0, 0, 0.04)"
                : "#000",
            border: "none",
            borderRadius: "78px",
            color: amountError
              ? "#F9363C"
              : isDepositButtonDisabled
                ? secondary
                : "#fff",
            cursor: isDepositButtonDisabled ? "default" : "pointer",
            display: "flex",
            fontFamily: font,
            fontSize: "17px",
            fontWeight: 500,
            height: "50px",
            justifyContent: "center",
            lineHeight: "22px",
            padding: "15px 12px",
            transition: "background 0.15s ease",
            width: "100%",
          }}
          type="button"
        >
          {amountError ?? "Deposit"}
        </button>
      </div>
    </div>
  );
}
