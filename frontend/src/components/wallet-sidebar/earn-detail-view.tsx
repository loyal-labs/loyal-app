"use client";

import NumberFlow, { continuous } from "@number-flow/react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  FALLBACK_EARN_FORECAST,
  formatEarnApyLabel,
  formatEarnApyPercent,
  getEarnForecastTargetMultiplier,
  type EarnForecastApy,
  type EarnForecastApyHistoryResponse,
} from "@/lib/kamino/earn-forecast.shared";
import type {
  EarnEarningsBar,
  EarnEarningsResponse,
  EarningsRangeId,
} from "@/lib/yield-optimization/earnings.shared";
import { useEarnEarnings } from "@/hooks/use-earn-earnings";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import { useEarnForecastApyHistory } from "@/hooks/use-earn-forecast-apy-history";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const POSITIVE_AMOUNT_COLOR = "#34C759";
const LOYAL_EARN_BRAND_COLOR = "#F9363C";
const MAIN_ACCOUNT_SHORT_ADDRESS = "BAqg...6qZZ";

const TOP_EARN_VAULT = {
  label: "Kamino · Lending Yield",
  logo: "/wallet-workspace/earn-kamino.png",
} as const;

const TOP_DEPOSIT_VAULT = {
  label: "Kamino · Lending Yield",
  logo: "/wallet-workspace/earn-deposit-kamino.png",
} as const;

const EARN_CHART_WIDTH = 508;
const EARN_CHART_HEIGHT = 400;
const EARN_CHART_BASELINE = 392;
const EARN_CHART_TOP = 8;
const MIN_DEPOSIT_USDC = 0.5;
const EARN_BALANCE_DECIMALS = 6;
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

export type EarnDepositDraft = {
  amount: number;
  amountLabel: string;
  forecastApyBps: number;
  source: EarnDepositSourceOption;
  symbol: "USDC";
  tokenDecimals: number;
  tokenMint: string | null;
};

export type EarnWithdrawDraft = {
  amount: number;
  amountLabel: string;
  destination: EarnDepositSourceOption;
  mode: "partial" | "full";
  symbol: "USDC";
  tokenDecimals: number;
};

export type EarnAutodepositDraft = {
  amount: number;
  amountLabel: string;
  amountChanged?: boolean;
  existingPolicySeed?: string;
  existingRecurringDelegation?: string;
  keepAmount: number;
  keepAmountChanged?: boolean;
  keepAmountLabel: string;
  nonce: bigint;
  requiresSignature?: boolean;
  source: EarnDepositSourceOption;
  symbol: "USDC";
  tokenDecimals: number;
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
  if (!Number.isFinite(value)) {
    return "0.00";
  }

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

export function formatEarnActionAmount(value: number) {
  if (!Number.isFinite(value)) {
    return "0.00";
  }

  const roundedUpValue = Math.ceil(value * 100) / 100;
  return roundedUpValue.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function formatEarnActionCtaAmount(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const roundedUpValue = Math.ceil(value * 100) / 100;
  return roundedUpValue.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function formatForecastAmountLabel(value: number) {
  if (!Number.isFinite(value)) {
    return "$0";
  }

  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}`;
}

function floorToBucks(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  // toFixed(4) absorbs float noise (8.83 * 100 === 882.9999…) before flooring.
  return Math.floor(Number((value * 100).toFixed(4))) / 100;
}

function formatBucksAmount(value: number) {
  return floorToBucks(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

export function clampBucksAmountInput(
  rawValue: string,
  previousValue: string,
  balance: number
) {
  if (rawValue === "") {
    return "";
  }

  if (!/^[\d,]*\.?\d*$/.test(rawValue)) {
    return null;
  }

  // Backspace collapses a stranded trailing dot so deleting "8.83" walks
  // 8.80 -> 8.00 -> 0.00 in one press per symbol instead of pausing on "8.".
  const isDeletion = rawValue.length < previousValue.length;
  const nextValue =
    isDeletion && rawValue.endsWith(".") ? rawValue.slice(0, -1) : rawValue;

  const decimals = nextValue.split(".")[1] ?? "";
  if (decimals.length > 2) {
    return null;
  }

  const numericValue = Number.parseFloat(nextValue.replace(/,/g, "")) || 0;
  if (numericValue > balance) {
    return formatBucksAmount(balance);
  }

  return nextValue;
}

function formatForecastMoney(value: number, mutedFraction = false) {
  const [whole, fraction = "00"] = formatMoney(value).split(".");
  return (
    <>
      ${whole}
      <span
        style={{ color: mutedFraction ? "rgba(60, 60, 67, 0.4)" : "inherit" }}
      >
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
const DEFAULT_FORECAST_AMOUNT = FORECAST_AMOUNT_PRESETS[2].value;
const USER_FORECAST_SELECTION = "you";

type ForecastAmountSelection = typeof USER_FORECAST_SELECTION | number;

type ForecastAmountOption = {
  id: string;
  label: string;
  selection: ForecastAmountSelection;
  value: number;
};

function hasUserForecastAmount(balance: number) {
  return Number.isFinite(balance) && balance > 0 ? balance : null;
}

function getCurrentForecastAmount(
  balance: number,
  currentAmount: number | null
) {
  if (hasUserForecastAmount(balance) === null) {
    return null;
  }

  return currentAmount !== null && Number.isFinite(currentAmount)
    ? currentAmount
    : balance;
}

export function getDefaultForecastSelection(
  balance: number
): ForecastAmountSelection {
  return hasUserForecastAmount(balance) === null
    ? DEFAULT_FORECAST_AMOUNT
    : USER_FORECAST_SELECTION;
}

export function getForecastAmountForSelection(
  selection: ForecastAmountSelection,
  balance: number,
  currentAmount: number | null
) {
  if (selection === USER_FORECAST_SELECTION) {
    return (
      getCurrentForecastAmount(balance, currentAmount) ??
      DEFAULT_FORECAST_AMOUNT
    );
  }

  return selection;
}

export function buildForecastAmountOptions(
  balance: number,
  currentAmount: number | null
): ForecastAmountOption[] {
  const currentForecastAmount = getCurrentForecastAmount(
    balance,
    currentAmount
  );
  const options: ForecastAmountOption[] = [];

  if (currentForecastAmount !== null) {
    options.push({
      id: USER_FORECAST_SELECTION,
      label: formatForecastAmountLabel(currentForecastAmount),
      selection: USER_FORECAST_SELECTION,
      value: currentForecastAmount,
    });
  }

  for (const preset of FORECAST_AMOUNT_PRESETS) {
    options.push({
      id: `preset:${preset.value}`,
      label: preset.label,
      selection: preset.value,
      value: preset.value,
    });
  }

  return options;
}

export function buildEarnChartPoints(
  principal: number,
  apy: EarnForecastApy = FALLBACK_EARN_APY
): EarnChartPoint[] {
  const months = 12;
  const target = principal * getEarnForecastTargetMultiplier(apy.apyBps);
  const lowTarget =
    principal * getEarnForecastTargetMultiplier(apy.rangeLowBps);
  const highTarget =
    principal * getEarnForecastTargetMultiplier(apy.rangeHighBps);

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

type EarnComparisonSeriesKey = "loyal" | "mainUsdcReserve" | "tBill";

const EARN_COMPARISON_SERIES: {
  color: string;
  dashed: boolean;
  fixedApyBps: number | null;
  key: EarnComparisonSeriesKey;
  label: string;
}[] = [
  {
    color: LOYAL_EARN_BRAND_COLOR,
    dashed: false,
    fixedApyBps: null,
    key: "loyal",
    label: "Loyal Earn",
  },
  {
    color: "#2688EB",
    dashed: true,
    fixedApyBps: 559,
    key: "mainUsdcReserve",
    label: "Main Market USDC",
  },
  {
    color: "#8E8E93",
    dashed: true,
    fixedApyBps: 365,
    key: "tBill",
    label: "T-Bill",
  },
];

const EARN_COMPARISON_MIN_APY_BPS = 50;

type EarnComparisonPoint = {
  date: string;
  index: number;
  values: Record<EarnComparisonSeriesKey, number>;
};

type EarnComparisonApyOverrides = Partial<
  Record<Exclude<EarnComparisonSeriesKey, "loyal">, number>
>;

function getEarnComparisonApyBps(
  forecastApyBps: number,
  fixedApyBps: number | null
): number {
  return Math.max(fixedApyBps ?? forecastApyBps, EARN_COMPARISON_MIN_APY_BPS);
}

export function buildEarnComparisonPoints(
  principal: number,
  apy: EarnForecastApy = FALLBACK_EARN_APY,
  apyOverrides: EarnComparisonApyOverrides = {}
): EarnComparisonPoint[] {
  const months = 12;
  const targets = EARN_COMPARISON_SERIES.reduce((acc, series) => {
    const overrideApyBps =
      series.key === "loyal" ? undefined : apyOverrides[series.key];
    const apyBps = getEarnComparisonApyBps(
      apy.apyBps,
      overrideApyBps ?? series.fixedApyBps
    );
    acc[series.key] = principal * getEarnForecastTargetMultiplier(apyBps);
    return acc;
  }, {} as Record<EarnComparisonSeriesKey, number>);

  return Array.from({ length: months + 1 }, (_, index) => {
    const progress = index / months;
    const eased = Math.pow(progress, 1.08);
    const values = EARN_COMPARISON_SERIES.reduce((acc, series) => {
      acc[series.key] = principal + (targets[series.key] - principal) * eased;
      return acc;
    }, {} as Record<EarnComparisonSeriesKey, number>);
    return {
      date: FORECAST_DATES[index] ?? FORECAST_DATES[FORECAST_DATES.length - 1],
      index,
      values,
    };
  });
}

export function deriveMainUsdcReserveForecastApyBps(
  history: Pick<EarnForecastApyHistoryResponse, "series">,
  fallbackApyBps = 559
): number {
  const latestSample = history.series
    ?.find((series) => series.key === "mainUsdcReserve")
    ?.samples.at(-1);
  return latestSample && Number.isFinite(latestSample.apyBps)
    ? latestSample.apyBps
    : fallbackApyBps;
}

function niceCeilStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  if (normalized <= 1) {
    return magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 2.5) {
    return 2.5 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
}

function getEarnApyRate(apyBps: number): number {
  return apyBps / 10_000;
}

export function getEarningsRatePerSecond(
  apyBps: number,
  principal: number
): number {
  return (principal * getEarnApyRate(apyBps)) / SECONDS_PER_YEAR;
}

export function deriveEarnWithdrawMode({
  amount,
  maxWithdrawAmount,
}: {
  amount: number;
  maxWithdrawAmount: number;
}): "partial" | "full" {
  // The input only accepts cents, so typing the visible (floored) max means
  // "withdraw everything" — compare at cent precision to avoid dust positions.
  return amount >= floorToBucks(maxWithdrawAmount) ? "full" : "partial";
}

function EarnYieldIcon({ size = 64 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      style={{ display: "inline-block", flexShrink: 0 }}
      viewBox="0 0 64 64"
      width={size}
    >
      <rect fill="#F9363C" height="64" rx="16" width="64" />
      <path
        d="M36 9.39795C36.22 9.35546 36.4427 9.3335 36.667 9.3335C41.4533 9.33394 45.3329 19.1837 45.333 31.3335C45.333 43.4835 41.4533 53.3331 36.667 53.3335C36.4427 53.3335 36.22 53.3125 36 53.27V53.3335H28L28 9.3335H36V9.39795Z"
        fill="#FD9528"
      />
      <ellipse cx="27.3346" cy="31.3335" fill="#FFD41B" rx="8.66667" ry="22" />
    </svg>
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
          transition: background 0.15s ease, transform 0.15s ease;
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

function EarnGrowingBalance({
  apyBps,
  baseAmount,
  isHidden = false,
  principalAmount,
}: {
  apyBps: number;
  baseAmount: number;
  isHidden?: boolean;
  principalAmount: number;
}) {
  const [value, setValue] = useState(baseAmount);

  useEffect(() => {
    setValue(baseAmount);
    const ratePerSecond = getEarningsRatePerSecond(apyBps, principalAmount);
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      const earned = ratePerSecond * elapsedSeconds;

      setValue(Number((baseAmount + earned).toFixed(EARN_BALANCE_DECIMALS)));
    }, EARN_BALANCE_SAMPLE_MS);

    return () => window.clearInterval(interval);
  }, [apyBps, baseAmount, principalAmount]);

  return (
    <>
      <style jsx>{`
        :global(.earn-growing-balance-flow) {
          --number-flow-mask-height: 0.12em;
          --number-flow-mask-width: 0.24em;
          color: ${isHidden ? "#BBBBC0" : "#000"};
          font-family: ${font};
          font-size: 40px;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          line-height: 46px;
        }
        :global(.earn-growing-balance-flow::part(decimal)),
        :global(.earn-growing-balance-flow::part(fraction)) {
          color: ${isHidden ? "#BBBBC0" : "rgba(60, 60, 67, 0.4)"};
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

const EARNINGS_CHART_HEIGHT = EARN_CHART_HEIGHT; // match the Forecast chart height
const EARNINGS_MONTHLY_RANGE_ID = "1Y" satisfies EarningsRangeId;

const EMPTY_EARNINGS_BARS: EarnEarningsBar[] = [];

// Skeleton bars for a freshly-funded position before real earnings data lands,
// so the chart always shows the current period (today / this month) as the last
// bar instead of a blank "No earnings yet". Mirrors the server bucketing shape.
function buildPlaceholderEarningsBars(
  rangeId: EarningsRangeId
): EarnEarningsBar[] {
  const now = new Date();
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  });
  const monthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  });
  const makeBar = (
    startAt: Date,
    endAt: Date,
    label: string,
    isCurrent: boolean
  ): EarnEarningsBar => ({
    apyBps: null,
    avgPrincipalUsd: 0,
    earnedUsd: 0,
    endAt: endAt.toISOString(),
    isCurrent,
    label,
    principalAmountRaw: "0",
    principalUsd: 0,
    startAt: startAt.toISOString(),
  });

  if (rangeId === "7D" || rangeId === "30D") {
    const count = rangeId === "7D" ? 7 : 30;
    return Array.from({ length: count }, (_, index) => {
      const offset = count - 1 - index;
      const dayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - offset
      );
      const dayEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - offset + 1
      );
      const isCurrent = offset === 0;
      return makeBar(
        dayStart,
        isCurrent ? now : dayEnd,
        dayFormatter.format(dayStart),
        isCurrent
      );
    });
  }

  if (rangeId === "1Y") {
    return Array.from({ length: 12 }, (_, index) => {
      const offset = 11 - index;
      const monthStart = new Date(
        now.getFullYear(),
        now.getMonth() - offset,
        1
      );
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth() - offset + 1,
        1
      );
      const isCurrent = offset === 0;
      return makeBar(
        monthStart,
        isCurrent ? now : monthEnd,
        monthFormatter.format(monthStart),
        isCurrent
      );
    });
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return [makeBar(monthStart, now, monthFormatter.format(monthStart), true)];
}

export function deriveEstimatedEarnedAmount({
  earningsData,
  earningsError,
}: {
  earningsData: EarnEarningsResponse | null;
  earningsError: string | null;
}) {
  if (earningsError || !earningsData) {
    return 0;
  }

  return Number.isFinite(earningsData.lifetimeEarnedUsd)
    ? earningsData.lifetimeEarnedUsd
    : 0;
}

export function deriveEstimatedEarnBalanceAmount({
  apyBps,
  earningsData,
  earningsError,
  generatedAt,
  principalAmount,
}: {
  apyBps: number;
  earningsData: EarnEarningsResponse | null;
  earningsError: string | null;
  generatedAt: string | null;
  principalAmount: number;
}) {
  if (earningsError || !earningsData) {
    return principalAmount;
  }

  const principalUsd = Number.isFinite(earningsData.principalUsd)
    ? earningsData.principalUsd
    : principalAmount;
  const lifetimeEarnedUsd = Number.isFinite(earningsData.lifetimeEarnedUsd)
    ? earningsData.lifetimeEarnedUsd
    : 0;
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const elapsedSeconds = Number.isFinite(generatedAtMs)
    ? Math.max(0, (Date.now() - generatedAtMs) / 1000)
    : 0;
  const liveEarnedUsd =
    getEarningsRatePerSecond(apyBps, principalAmount) * elapsedSeconds;

  return Number(
    (principalUsd + lifetimeEarnedUsd + liveEarnedUsd).toFixed(
      EARN_BALANCE_DECIMALS
    )
  );
}

export function deriveEstimatedEarnedAmountApyBps({
  earningsData,
  earningsError,
  fallbackApyBps,
}: {
  earningsData: EarnEarningsResponse | null;
  earningsError: string | null;
  fallbackApyBps: number;
}) {
  if (earningsError || !earningsData || earningsData.currentApyBps === null) {
    return Number.isFinite(fallbackApyBps) ? fallbackApyBps : 0;
  }

  return Number.isFinite(earningsData.currentApyBps)
    ? earningsData.currentApyBps
    : 0;
}

function getEarningsFractionDigits(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue > 0 && absoluteValue < 0.01) {
    return EARN_BALANCE_DECIMALS;
  }
  return 2;
}

export function formatMonthlyEarningsBarLabel(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatEarningsAmount(value: number) {
  if (!Number.isFinite(value)) {
    return "+$0.00";
  }
  const fractionDigits = getEarningsFractionDigits(value);
  const formatted = value.toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
  return `+$${formatted}`;
}

function formatSignedEarningsAmount(value: number) {
  if (!Number.isFinite(value)) {
    return "+$0.00";
  }
  const fractionDigits = getEarningsFractionDigits(value);
  const sign = value >= 0 ? "+" : "-";
  const formatted = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
  return `${sign}$${formatted}`;
}

type EarnChartTab = "Earnings" | "Forecast" | "Historical";

const EARN_CHART_TABS: readonly {
  id: EarnChartTab;
  label: string;
}[] = [
  { id: "Forecast", label: "Forecast" },
  { id: "Historical", label: "APY" },
  { id: "Earnings", label: "Earned" },
];

function EarningsBlock({
  apy,
  earningsData,
  estimatedEarnedUsd,
  isBalanceHidden = false,
  principalAmount,
}: {
  apy: EarnForecastApy;
  earningsData: EarnEarningsResponse | null;
  estimatedEarnedUsd: number;
  isBalanceHidden?: boolean;
  principalAmount: number;
}) {
  const [activeTab, setActiveTab] = useState<EarnChartTab>("Forecast");
  const [earningsRevision, setEarningsRevision] = useState(0);
  const [forecastRevision, setForecastRevision] = useState(0);
  const [historicalRevision, setHistoricalRevision] = useState(0);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const handleTabChange = (next: EarnChartTab) => {
    if (next === activeTab) return;
    setActiveTab(next);
    setHoveredBar(null);
    if (next === "Earnings") {
      setEarningsRevision((r) => r + 1);
    } else if (next === "Forecast") {
      setForecastRevision((r) => r + 1);
    } else {
      setHistoricalRevision((r) => r + 1);
    }
  };
  const forecastAmount = principalAmount;
  const placeholderBars = useMemo(
    () =>
      principalAmount > 0
        ? buildPlaceholderEarningsBars(EARNINGS_MONTHLY_RANGE_ID)
        : EMPTY_EARNINGS_BARS,
    [principalAmount]
  );
  const realBars = earningsData?.bars ?? EMPTY_EARNINGS_BARS;
  const bars = realBars.length > 0 ? realBars : placeholderBars;
  // Display earnings cumulatively (running total): earnings only accrue, so each
  // period is never lower than the previous — "today" >= "yesterday".
  const cumulativeBars = useMemo(() => {
    let running = 0;
    return bars.map((bar) => {
      running += Math.max(0, bar.earnedUsd);
      // The current (last) period usually has no settled earnings yet, which
      // would render an empty bar. Fall back to the live estimate so it always
      // shows a real, non-zero bar.
      const cumulativeUsd = bar.isCurrent
        ? Math.max(running, estimatedEarnedUsd)
        : running;
      return {
        ...bar,
        cumulativeUsd,
        label: formatMonthlyEarningsBarLabel(bar.startAt),
      };
    });
  }, [bars, estimatedEarnedUsd]);
  const maxValue = useMemo(() => {
    const peak = Math.max(...cumulativeBars.map((bar) => bar.cumulativeUsd), 0);
    return Math.max(0.01, peak);
  }, [cumulativeBars]);
  const hoveredBarEntry =
    hoveredBar !== null ? cumulativeBars[hoveredBar] : null;
  const earningsAxisLabels =
    cumulativeBars.length > 0
      ? [
          cumulativeBars[0].label,
          cumulativeBars[Math.floor((cumulativeBars.length - 1) / 2)].label,
          cumulativeBars[cumulativeBars.length - 1].label,
        ]
      : [];
  const hoveredFractionDigits = hoveredBarEntry
    ? getEarningsFractionDigits(hoveredBarEntry.cumulativeUsd)
    : 2;
  // Anchor the hover card to the bar's center and shift it by the same fraction
  // of its own width, so it tracks the bar across the full range and never
  // overflows the chart edges (left-aligned near the start, right-aligned near
  // the end) instead of clamping halfway.
  const hoverFraction =
    hoveredBar !== null && cumulativeBars.length > 0
      ? (hoveredBar + 0.5) / cumulativeBars.length
      : 0;

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
          color: ${isBalanceHidden ? "#BBBBC0" : "#000"};
          font-family: ${font};
          font-size: 28px;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          line-height: 32px;
        }
        :global(.earnings-current-flow::part(decimal)),
        :global(.earnings-current-flow::part(fraction)) {
          color: ${isBalanceHidden ? "#BBBBC0" : "rgba(60, 60, 67, 0.4)"};
        }
        .earnings-bar {
          align-items: flex-end;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          flex: 1 0 0;
          height: 100%;
          min-width: 0;
          padding: 0;
          transition: background 0.18s ease;
        }
        .earnings-bar:hover,
        .earnings-bar-active {
          background: rgba(0, 0, 0, 0.04);
        }
        .earnings-bar-fill {
          background: #34c759;
          border: none;
          border-radius: 4px;
          display: block;
          transform-origin: center bottom;
          animation: earnings-bar-rise 0.55s cubic-bezier(0.2, 0, 0, 1) both;
          animation-delay: calc(var(--bar-index, 0) * 14ms);
          transition: background 0.18s ease;
          width: 100%;
        }
        .earnings-bar-zero .earnings-bar-fill {
          background: rgba(52, 199, 89, 0.32);
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
        .earnings-bar-tooltip {
          animation: earnings-tooltip-fade 0.16s ease both;
        }
        @keyframes earnings-tooltip-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        .earnings-tab-panel {
          transition: opacity 0.34s cubic-bezier(0.2, 0, 0, 1),
            transform 0.34s cubic-bezier(0.2, 0, 0, 1),
            filter 0.34s cubic-bezier(0.2, 0, 0, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .earnings-bar-fill,
          .earnings-bar-tooltip {
            animation: none;
          }
          .earnings-tab-panel {
            transition: none;
          }
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
          {EARN_CHART_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
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
                {tab.label}
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
          aria-hidden={activeTab !== "Historical"}
          className="earnings-tab-panel"
          key={`historical-${historicalRevision}`}
          style={{
            filter: activeTab === "Historical" ? "blur(0)" : "blur(2px)",
            gridArea: "panel",
            opacity: activeTab === "Historical" ? 1 : 0,
            pointerEvents: activeTab === "Historical" ? "auto" : "none",
            transform:
              activeTab === "Historical"
                ? "translateY(0) scale(1)"
                : "translateY(6px) scale(0.985)",
          }}
        >
          <div style={{ padding: "12px", width: "100%" }}>
            <HistoricalApyChart key="30D" rangeId="30D" />
          </div>
        </div>
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
              isBalanceHidden={isBalanceHidden}
              key={forecastAmount}
              principal={forecastAmount}
            />
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
              padding: "14px 14px 0",
              width: "100%",
            }}
          >
            <div style={{ position: "relative", width: "100%" }}>
              <div
                key="earnings-bars-monthly"
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
                {cumulativeBars.map((bar, i) => {
                  const heightPct =
                    maxValue > 0 ? (bar.cumulativeUsd / maxValue) * 100 : 0;
                  const isZeroValue = bar.cumulativeUsd <= 0;
                  const isCurrentPositive =
                    bar.isCurrent && bar.cumulativeUsd > 0;
                  const visualHeightPct = isCurrentPositive
                    ? Math.max(heightPct, 18)
                    : heightPct;
                  const isActive = hoveredBar === i;
                  const minHeightPx = 4;
                  return (
                    <button
                      aria-label={`${bar.label} earnings ${formatEarningsAmount(
                        bar.cumulativeUsd
                      )}`}
                      className={`earnings-bar${
                        isActive ? " earnings-bar-active" : ""
                      }${isZeroValue ? " earnings-bar-zero" : ""}`}
                      key={`${bar.startAt}:${bar.endAt}`}
                      onMouseEnter={() => setHoveredBar(i)}
                      style={{
                        ["--bar-index" as never]: i,
                      }}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="earnings-bar-fill"
                        style={{
                          height: `max(${minHeightPx}px, ${visualHeightPct.toFixed(
                            2
                          )}%)`,
                        }}
                      />
                    </button>
                  );
                })}
                {cumulativeBars.length === 0 ? (
                  <div
                    style={{
                      alignItems: "center",
                      color: secondary,
                      display: "flex",
                      flex: 1,
                      fontFamily: font,
                      fontSize: "13px",
                      height: "100%",
                      justifyContent: "center",
                      lineHeight: "16px",
                    }}
                  >
                    No earnings yet
                  </div>
                ) : null}
              </div>

              {hoveredBarEntry ? (
                <div
                  className="earnings-bar-tooltip"
                  style={{
                    background: "#fff",
                    border: "1px solid rgba(0, 0, 0, 0.08)",
                    borderRadius: "14px",
                    boxShadow: "0 8px 22px rgba(0, 0, 0, 0.12)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    left: `clamp(100px, ${
                      hoverFraction * 100
                    }%, calc(100% - 100px))`,
                    padding: "8px 12px",
                    pointerEvents: "none",
                    position: "absolute",
                    top: "8px",
                    transform: "translateX(-50%)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      color: isBalanceHidden ? "#BBBBC0" : "#000",
                      filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                      fontFamily: font,
                      fontSize: "20px",
                      fontWeight: 600,
                      lineHeight: "24px",
                    }}
                  >
                    {`$${hoveredBarEntry.cumulativeUsd.toLocaleString("en-US", {
                      maximumFractionDigits: hoveredFractionDigits,
                      minimumFractionDigits: hoveredFractionDigits,
                    })}`}
                  </span>
                  <span
                    style={{
                      fontFamily: font,
                      fontSize: "13px",
                      lineHeight: "16px",
                    }}
                  >
                    <span style={{ color: POSITIVE_AMOUNT_COLOR }}>
                      {formatSignedEarningsAmount(
                        hoveredBarEntry.cumulativeUsd
                      )}
                    </span>
                    <span style={{ color: secondary }}>
                      {" · "}
                      {hoveredBarEntry.label}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 12px 0",
              width: "100%",
            }}
          >
            {earningsAxisLabels.map((label, index) => (
              <span
                key={`${label}-${index}`}
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  lineHeight: "16px",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AutodepositToggle({
  disabled = false,
  isOn,
  onToggle,
}: {
  disabled?: boolean;
  isOn: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      aria-checked={isOn}
      aria-label={isOn ? "Pause Autodeposit" : "Resume Autodeposit"}
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      style={{
        alignItems: "center",
        background: isOn ? LOYAL_EARN_BRAND_COLOR : "rgba(120, 120, 128, 0.32)",
        border: "none",
        borderRadius: "9999px",
        cursor: disabled ? "default" : "pointer",
        display: "inline-flex",
        flexShrink: 0,
        height: "31px",
        justifyContent: isOn ? "flex-end" : "flex-start",
        padding: "2px",
        transition: "background 0.2s ease",
        width: "51px",
      }}
      type="button"
    >
      <span
        style={{
          background: "#fff",
          borderRadius: "9999px",
          boxShadow: "0 3px 8px rgba(0, 0, 0, 0.15)",
          height: "27px",
          width: "27px",
        }}
      />
    </button>
  );
}

function AutodepositCard({
  amountLabel,
  floorLabel,
  isConfigured = false,
  state = "idle",
  onDisable,
  onSetUp,
}: {
  amountLabel?: string;
  floorLabel?: string;
  isConfigured?: boolean;
  state?: "closing" | "created" | "creating" | "idle" | "paused";
  onDisable?: () => void;
  onSetUp?: () => void;
}) {
  const isBusy = state === "creating" || state === "closing";
  const statusLabel =
    state === "creating"
      ? "Creating allowance and policy"
      : state === "closing"
      ? "Removing allowance and refunding rent"
      : state === "paused"
      ? "Paused"
      : `Up to ${amountLabel ?? "$0"}/mo above ${floorLabel ?? "$0"}`;

  if (isConfigured) {
    return (
      <>
        <style jsx>{`
          .earn-autodeposit-settings {
            transition: background 0.15s ease;
          }
          .earn-autodeposit-settings:hover {
            background: rgba(0, 0, 0, 0.06) !important;
          }
        `}</style>
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              borderRadius: "16px",
              display: "flex",
              gap: "8px",
              overflow: "hidden",
              padding: "0 12px",
              width: "100%",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                padding: "6px 12px 6px 0",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                src="/wallet-workspace/earn-coin-icon.svg"
                style={{ flexShrink: 0, height: "48px", width: "48px" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: "2px",
                minWidth: 0,
                padding: "10px 0",
              }}
            >
              <span
                style={{
                  color: "#000",
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 500,
                  letterSpacing: "-0.176px",
                  lineHeight: "20px",
                }}
              >
                Autodeposit
              </span>
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                }}
              >
                {statusLabel}
              </span>
            </div>
            <button
              aria-label="Edit Autodeposit"
              className="earn-autodeposit-settings"
              onClick={onSetUp}
              style={{
                alignItems: "center",
                background: "transparent",
                border: "none",
                borderRadius: "9999px",
                color: "#3C3C43",
                cursor: "pointer",
                display: "inline-flex",
                flexShrink: 0,
                height: "32px",
                justifyContent: "center",
                padding: "4px",
                width: "32px",
              }}
              type="button"
            >
              <SlidersHorizontal size={20} strokeWidth={2} />
            </button>
            <AutodepositToggle
              disabled={isBusy}
              isOn={!isBusy && state !== "paused"}
              onToggle={onDisable}
            />
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <style jsx>{`
        .earn-autodeposit-btn {
          transition: background 0.15s ease, transform 0.15s ease;
        }
        .earn-autodeposit-btn:hover {
          background: #1a1a1a !important;
          transform: translateY(-1px);
        }
        .earn-autodeposit-btn:active {
          transform: translateY(0);
        }
      `}</style>
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "8px",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderRadius: "16px",
            display: "flex",
            overflow: "hidden",
            padding: "0 12px",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              padding: "6px 12px 6px 0",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              src="/wallet-workspace/earn-coin-icon.svg"
              style={{ flexShrink: 0, height: "48px", width: "48px" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
              padding: "10px 0",
            }}
          >
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                letterSpacing: "-0.176px",
                lineHeight: "20px",
              }}
            >
              Autodeposit
            </span>
            <span
              style={{
                color: "rgba(60, 60, 67, 0.6)",
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                maxWidth: "300px",
              }}
            >
              Start earning the moment your money arrives
            </span>
          </div>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              height: "52px",
              justifyContent: "flex-end",
              paddingLeft: "12px",
            }}
          >
            <button
              className="earn-autodeposit-btn"
              onClick={onSetUp}
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
                whiteSpace: "nowrap",
              }}
              type="button"
            >
              Set up
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

export function EarnDetailView({
  autodepositAmountLabel,
  autodepositFloorLabel,
  autodepositState = "idle",
  currentPositionApyLabel,
  currentPositionMarketName = "Main Market",
  currentPositionTokenSymbol = "USDC",
  earningsCacheKey,
  earningsCacheScope,
  hasCurrentPosition = false,
  isAutodepositConfigured = false,
  isBalanceHidden = false,
  onDeposit,
  onDisableAutodeposit,
  onOpenAutodeposit,
  onWithdraw,
  principalAmount = 0,
}: {
  autodepositAmountLabel?: string;
  autodepositFloorLabel?: string;
  autodepositState?: "closing" | "created" | "creating" | "idle" | "paused";
  currentPositionApyLabel?: string;
  currentPositionMarketName?: string;
  currentPositionTokenSymbol?: string;
  earningsCacheKey?: string;
  earningsCacheScope?: {
    expectedPrincipalAmountRaw?: string | null;
    settingsPda?: string | null;
    solanaEnv?: string;
    walletAddress?: string | null;
  };
  hasCurrentPosition?: boolean;
  isAutodepositConfigured?: boolean;
  isBalanceHidden?: boolean;
  onDeposit?: () => void;
  onDisableAutodeposit?: () => void;
  onOpenAutodeposit?: () => void;
  onWithdraw?: () => void;
  principalAmount?: number;
}) {
  const earnForecastApy = useEarnForecastApy();
  const { data: earningsRangeSet, error: earningsError } = useEarnEarnings({
    cacheKey: earningsCacheKey,
    enabled: hasCurrentPosition,
    expectedPrincipalAmountRaw: earningsCacheScope?.expectedPrincipalAmountRaw,
    settingsPda: earningsCacheScope?.settingsPda,
    solanaEnv: earningsCacheScope?.solanaEnv,
    walletAddress: earningsCacheScope?.walletAddress,
  });
  const earningsData =
    earningsRangeSet?.ranges[EARNINGS_MONTHLY_RANGE_ID] ?? null;
  const estimatedEarnedAmountApyBps = deriveEstimatedEarnedAmountApyBps({
    earningsData,
    earningsError,
    fallbackApyBps: earnForecastApy.apyBps,
  });
  const displayBalanceAmount = deriveEstimatedEarnBalanceAmount({
    apyBps: estimatedEarnedAmountApyBps,
    earningsData,
    earningsError,
    generatedAt: earningsRangeSet?.generatedAt ?? null,
    principalAmount,
  });
  const estimatedEarnedUsd = Math.max(
    0,
    displayBalanceAmount - principalAmount
  );
  const earnedSummaryLabel = currentPositionApyLabel
    ? `${formatSignedEarningsAmount(
        estimatedEarnedUsd
      )} (${currentPositionApyLabel})`
    : formatSignedEarningsAmount(estimatedEarnedUsd);

  return (
    <div
      className="scrollbar-hide"
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowX: "hidden",
        overflowY: "auto",
        width: "100%",
      }}
    >
      {/* SVG pixelation filters */}
      <svg
        aria-hidden="true"
        height="0"
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
        }}
        width="0"
      >
        <defs>
          <filter id="rs-pixelate-lg" x="0" y="0" width="100%" height="100%">
            <feFlood x="4" y="4" height="2" width="2" />
            <feComposite width="10" height="10" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="5" />
          </filter>
          <filter id="rs-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>

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
          gap: "12px",
          overflow: "hidden",
          padding: "2px 20px 4px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", flexShrink: 0 }}>
          <EarnYieldIcon />
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
          {hasCurrentPosition ? null : (
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "20px",
              }}
            >
              Balance
            </span>
          )}
          <span
            style={{
              color: isBalanceHidden ? "#BBBBC0" : "#000",
              filter: isBalanceHidden ? "url(#rs-pixelate-lg)" : "none",
              fontFamily: font,
              fontSize: "40px",
              fontWeight: 600,
              lineHeight: "46px",
              transition: "filter 0.15s ease, color 0.15s ease",
              userSelect: isBalanceHidden ? "none" : "auto",
              whiteSpace: "nowrap",
            }}
          >
            {hasCurrentPosition ? (
              <EarnGrowingBalance
                apyBps={estimatedEarnedAmountApyBps}
                baseAmount={displayBalanceAmount}
                isHidden={isBalanceHidden}
                principalAmount={principalAmount}
              />
            ) : (
              <>
                $0
                <span
                  style={{
                    color: isBalanceHidden
                      ? "#BBBBC0"
                      : "rgba(60, 60, 67, 0.4)",
                  }}
                >
                  .00
                </span>
              </>
            )}
          </span>
          {hasCurrentPosition ? (
            <span
              style={{
                color: isBalanceHidden ? "#BBBBC0" : "#34C759",
                filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                transition: "filter 0.15s ease, color 0.15s ease",
                userSelect: isBalanceHidden ? "none" : "auto",
                whiteSpace: "nowrap",
              }}
            >
              {earnedSummaryLabel}
            </span>
          ) : null}
        </div>
      </div>

      {hasCurrentPosition ? <div style={{ height: "9px" }} /> : null}

      {hasCurrentPosition ? (
        <EarningsBlock
          apy={earnForecastApy}
          earningsData={earningsData}
          estimatedEarnedUsd={estimatedEarnedUsd}
          isBalanceHidden={isBalanceHidden}
          key={`${principalAmount}:${earnForecastApy.apyBps}`}
          principalAmount={principalAmount}
        />
      ) : null}

      <AutodepositCard
        amountLabel={autodepositAmountLabel}
        floorLabel={autodepositFloorLabel}
        isConfigured={isAutodepositConfigured}
        state={autodepositState}
        onDisable={onDisableAutodeposit}
        onSetUp={onOpenAutodeposit}
      />

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
                  color: "#000",
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 500,
                  letterSpacing: "-0.176px",
                  lineHeight: "20px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {currentPositionMarketName}
              </span>
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
                {currentPositionTokenSymbol}
              </span>
            </div>
            <span
              style={{
                color: isBalanceHidden ? "#BBBBC0" : "#000",
                filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                lineHeight: "20px",
                marginLeft: "12px",
                transition: "filter 0.15s ease, color 0.15s ease",
                userSelect: isBalanceHidden ? "none" : "auto",
                whiteSpace: "nowrap",
              }}
            >
              {formatForecastMoney(principalAmount, true)}
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
          transition: background 0.15s ease, transform 0.15s ease;
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
  isStatic = false,
  onClick,
  subtitle,
}: {
  amount: string;
  icon: string;
  isDropdown?: boolean;
  isOpen?: boolean;
  isPosition?: boolean;
  isSelected?: boolean;
  isStatic?: boolean;
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
        borderRadius: isDropdown || isStatic ? "16px" : "8px",
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

function bucksMaskCompletion(value: string) {
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1) {
    return ".00";
  }

  const decimals = value.length - dotIndex - 1;
  if (decimals === 0) {
    return "00";
  }
  if (decimals === 1) {
    return "0";
  }
  return "";
}

function BucksAmountInput({
  inputRef,
  onValueChange,
  value,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onValueChange: (rawValue: string) => void;
  value: string;
}) {
  const maskCompletion = bucksMaskCompletion(value);
  const amountTextStyle = {
    fontFamily: font,
    fontSize: "40px",
    fontWeight: 600,
    lineHeight: "48px",
  } as const;

  return (
    <div
      style={{
        alignItems: "baseline",
        display: "flex",
        minWidth: 0,
      }}
    >
      <style jsx>{`
        .bucks-amount-input::selection {
          background: rgba(249, 54, 60, 0.18);
        }
        .bucks-amount-input::placeholder {
          color: rgba(60, 60, 67, 0.4);
          opacity: 1;
        }
      `}</style>
      <span aria-hidden="true" style={{ ...amountTextStyle, color: "#000" }}>
        $
      </span>
      <span
        style={{
          display: "inline-grid",
          minWidth: "1ch",
        }}
      >
        {/* Hidden replica auto-sizes the grid cell to the exact text width so
            the gray mask completion sits flush against the typed digits. */}
        <span
          aria-hidden="true"
          style={{
            ...amountTextStyle,
            gridArea: "1 / 1",
            visibility: "hidden",
            whiteSpace: "pre",
          }}
        >
          {value || "0"}
        </span>
        <input
          className="bucks-amount-input"
          inputMode="decimal"
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="0"
          ref={inputRef}
          // size=1 keeps the input's intrinsic width from inflating the grid
          // track; the hidden replica alone sizes the cell, so the gray mask
          // stays flush against the typed digits.
          size={1}
          style={{
            ...amountTextStyle,
            background: "transparent",
            border: "none",
            color: "#000",
            gridArea: "1 / 1",
            minWidth: 0,
            outline: "none",
            padding: 0,
            width: "100%",
          }}
          type="text"
          value={value}
        />
      </span>
      {maskCompletion ? (
        <span
          aria-hidden="true"
          style={{ ...amountTextStyle, color: "rgba(60, 60, 67, 0.4)" }}
        >
          {maskCompletion}
        </span>
      ) : null}
    </div>
  );
}

export function EarnWithdrawView({
  isSubmitting = false,
  maxWithdrawAmount = 1280,
  onClose,
  onDraftChange,
  onDraftSubmit,
  onComplete,
  destinations = FALLBACK_EARN_DEPOSIT_SOURCES,
}: {
  isSubmitting?: boolean;
  maxWithdrawAmount?: number;
  onClose?: () => void;
  onDraftChange?: (draft: EarnWithdrawDraft | null) => void;
  onDraftSubmit?: (draft: EarnWithdrawDraft) => void | Promise<void>;
  onComplete?: (withdrawal: {
    amount: number;
    mode: "partial" | "full";
  }) => void | Promise<void>;
  destinations?: EarnDepositSourceOption[];
}) {
  const withdrawAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
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
  const numericWithdrawAmount = Number(withdrawAmount.replace(/,/g, ""));
  const effectiveWithdrawAmount = hasWithdrawAmount ? numericWithdrawAmount : 0;
  const effectiveWithdrawAmountLabel = hasWithdrawAmount ? withdrawAmount : "";
  const isFullWithdraw =
    hasWithdrawAmount &&
    Number.isFinite(effectiveWithdrawAmount) &&
    deriveEarnWithdrawMode({
      amount: effectiveWithdrawAmount,
      maxWithdrawAmount,
    }) === "full";
  const withdrawAmountError =
    !hasWithdrawAmount ||
    !Number.isFinite(effectiveWithdrawAmount) ||
    effectiveWithdrawAmount <= 0
      ? "Enter an amount"
      : hasWithdrawAmount && numericWithdrawAmount > maxWithdrawAmount
      ? "Insufficient balance"
      : null;
  const isWithdrawButtonDisabled = isSubmitting || withdrawAmountError !== null;
  const withdrawButtonLabel = isSubmitting
    ? "Withdrawing..."
    : withdrawAmountError ??
      `Withdraw ${formatEarnActionCtaAmount(effectiveWithdrawAmount)} USDC`;
  const buildCurrentDraft = (): EarnWithdrawDraft => ({
    amount: effectiveWithdrawAmount,
    amountLabel: effectiveWithdrawAmountLabel,
    destination: selectedDestination,
    mode: isFullWithdraw ? "full" : "partial",
    symbol: "USDC",
    tokenDecimals: 6,
  });

  useEffect(() => {
    if (!destinationOptions.some((dest) => dest.id === selectedDestinationId)) {
      setSelectedDestinationId(
        destinationOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
      );
    }
  }, [destinationOptions, selectedDestinationId]);

  useEffect(() => {
    onDraftChange?.(null);
  }, [onDraftChange, selectedDestination, withdrawAmount]);

  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      withdrawAmountInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
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
        .earn-withdraw-submit:not(:disabled):hover {
          background: #222 !important;
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
            onClick={() => {
              withdrawAmountInputRef.current?.focus();
              withdrawAmountInputRef.current?.select();
            }}
            style={{
              alignItems: "center",
              cursor: "text",
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <BucksAmountInput
              inputRef={withdrawAmountInputRef}
              onValueChange={(rawValue) => {
                const clampedValue = clampBucksAmountInput(
                  rawValue,
                  withdrawAmount,
                  maxWithdrawAmount
                );
                if (clampedValue !== null) {
                  setWithdrawAmount(clampedValue);
                }
              }}
              value={withdrawAmount}
            />
          </div>
        </section>

        <section
          style={{
            padding: "8px",
            position: "relative",
            width: "100%",
            zIndex: 2,
          }}
        >
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
            amount={maxWithdrawAmount.toLocaleString("en-US", {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            })}
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
            isStatic
            subtitle={`${selectedDestination.label} · ${selectedDestination.addressLabel}`}
          />
        </section>
      </div>

      <div
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
          padding: "16px 32px 24px",
          width: "100%",
        }}
      >
        <button
          className="earn-withdraw-submit"
          disabled={isWithdrawButtonDisabled}
          onClick={() =>
            onDraftSubmit
              ? void onDraftSubmit(buildCurrentDraft())
              : void onComplete?.({
                  amount: effectiveWithdrawAmount,
                  mode: isFullWithdraw ? "full" : "partial",
                })
          }
          style={{
            alignItems: "center",
            background: isWithdrawButtonDisabled
              ? "rgba(0, 0, 0, 0.04)"
              : "#000",
            border: "none",
            borderRadius: "78px",
            color: isWithdrawButtonDisabled ? secondary : "#fff",
            cursor: isWithdrawButtonDisabled ? "default" : "pointer",
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
          {withdrawButtonLabel}
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
  isStatic = false,
  isTrigger = false,
  onClick,
  source,
}: {
  isHighlighted?: boolean;
  isOpen?: boolean;
  isSelected?: boolean;
  isStatic?: boolean;
  isTrigger?: boolean;
  onClick?: () => void;
  source: EarnDepositSourceOption;
}) {
  return (
    <>
      <style jsx>{`
        .earn-source-trigger,
        .earn-source-option {
          transition: background 0.15s ease, transform 0.18s ease;
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
        className={
          isStatic
            ? undefined
            : isTrigger
            ? "earn-source-trigger"
            : "earn-source-option"
        }
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
          borderRadius: isTrigger || isStatic ? "16px" : "8px",
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
              <ChevronsDownUp color="#B1B1B4" size={24} strokeWidth={2} />
            ) : (
              <ChevronsUpDown color="#B1B1B4" size={24} strokeWidth={2} />
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

type HistoricalApySample = {
  apyPercent: number;
  date: string;
  observedAtMs: number;
};
type HistoricalApyBenchmarkLine = {
  apyPercentAtHover: number;
  color: string;
  d: string;
  key: Exclude<EarnComparisonSeriesKey, "loyal">;
  label: string;
  samples?: HistoricalApySample[];
  topPercent: number;
};

const HISTORICAL_APY_BASELINE = 5;
const HISTORICAL_APY_MIN = 2.5;
const HISTORICAL_APY_STATIC_BENCHMARKS = EARN_COMPARISON_SERIES.filter(
  (
    series
  ): series is (typeof EARN_COMPARISON_SERIES)[number] & {
    fixedApyBps: number;
  } => series.key !== "loyal" && series.key !== "mainUsdcReserve"
);
const HISTORICAL_RANGE_CONFIG: Record<
  EarningsRangeId,
  { points: number; seed: number; spanDays: number }
> = {
  "7D": { points: 112, seed: 17, spanDays: 7 },
  "30D": { points: 168, seed: 30, spanDays: 30 },
  "1Y": { points: 184, seed: 365, spanDays: 365 },
  ALL: { points: 208, seed: 540, spanDays: 540 },
};
// Fixed spike positions/magnitudes so the mocked line resembles the reference
// screenshot: a calm ~5% baseline with a sharp burst up to ~33% APY.
const HISTORICAL_APY_SPIKES = [
  { at: 0.31, magnitude: 7, width: 0.006 },
  { at: 0.34, magnitude: 28, width: 0.005 },
  { at: 0.38, magnitude: 18, width: 0.006 },
  { at: 0.42, magnitude: 8, width: 0.008 },
  { at: 0.46, magnitude: 9, width: 0.006 },
  { at: 0.54, magnitude: 4, width: 0.016 },
  { at: 0.86, magnitude: 3, width: 0.02 },
];

// Deterministic PRNG (mulberry32) keyed per range so the mocked series is
// stable across re-renders and only changes when the period changes.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function formatHistoricalAxisDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function formatHistoricalApyDelta(
  deltaPercent: number,
  benchmarkLabel = "Main Market USDC"
): string {
  const sign = deltaPercent >= 0 ? "+" : "-";
  return `${sign}${Math.abs(deltaPercent).toFixed(2)}% vs ${benchmarkLabel}`;
}

function buildHistoricalApySamples(
  rangeId: EarningsRangeId,
  now: Date
): HistoricalApySample[] {
  const config = HISTORICAL_RANGE_CONFIG[rangeId];
  const random = mulberry32(config.seed);
  const endMs = now.getTime();
  const spanMs = config.spanDays * 24 * 60 * 60 * 1000;

  return Array.from({ length: config.points }, (_, index) => {
    const progress = index / (config.points - 1);
    let apyPercent =
      HISTORICAL_APY_BASELINE +
      (random() - 0.5) * 1.2 +
      Math.sin(index * 0.7 + config.seed) * 0.35;

    for (const spike of HISTORICAL_APY_SPIKES) {
      const distance = (progress - spike.at) / spike.width;
      if (Math.abs(distance) < 6) {
        apyPercent +=
          spike.magnitude *
          Math.exp(-(distance * distance)) *
          (0.85 + random() * 0.3);
      }
    }

    return {
      apyPercent: Math.max(HISTORICAL_APY_MIN, apyPercent),
      date: formatHistoricalAxisDate(new Date(endMs - spanMs * (1 - progress))),
      observedAtMs: endMs - spanMs * (1 - progress),
    };
  });
}

function toHistoricalApySamples(
  history: ReturnType<typeof useEarnForecastApyHistory>
): HistoricalApySample[] {
  const loyalSeries = history.series?.find((series) => series.key === "loyal");
  const samples = loyalSeries?.samples.length
    ? loyalSeries.samples
    : history.samples;

  return samples.map((sample) => ({
    apyPercent: sample.apyBps / 100,
    date: formatHistoricalAxisDate(new Date(sample.observedAt)),
    observedAtMs: Date.parse(sample.observedAt),
  }));
}

function toHistoricalBenchmarkSamples(
  history: ReturnType<typeof useEarnForecastApyHistory>,
  key: Exclude<EarnComparisonSeriesKey, "loyal">
): HistoricalApySample[] {
  const series = history.series?.find((item) => item.key === key);
  if (!series) {
    return [];
  }

  return series.samples.map((sample) => ({
    apyPercent: sample.apyBps / 100,
    date: formatHistoricalAxisDate(new Date(sample.observedAt)),
    observedAtMs: Date.parse(sample.observedAt),
  }));
}

function nearestHistoricalApyPercent(
  samples: readonly HistoricalApySample[] | undefined,
  observedAtMs: number,
  fallback: number
): number {
  if (!samples || samples.length === 0) {
    return fallback;
  }

  return samples.reduce((nearest, sample) =>
    Math.abs(sample.observedAtMs - observedAtMs) <
    Math.abs(nearest.observedAtMs - observedAtMs)
      ? sample
      : nearest
  ).apyPercent;
}

function HistoricalApyChart({ rangeId }: { rangeId: EarningsRangeId }) {
  const apyHistory = useEarnForecastApyHistory();
  const samples = useMemo(() => {
    const fetchedSamples = toHistoricalApySamples(apyHistory);
    if (rangeId === "30D" && fetchedSamples.length > 0) {
      return fetchedSamples;
    }

    return buildHistoricalApySamples(rangeId, new Date());
  }, [apyHistory, rangeId]);
  const mainUsdcSamples = useMemo(() => {
    if (rangeId !== "30D") {
      return [];
    }

    return toHistoricalBenchmarkSamples(apyHistory, "mainUsdcReserve");
  }, [apyHistory, rangeId]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const maxApy = samples.reduce(
    (max, sample) => Math.max(max, sample.apyPercent),
    0
  );
  const maxMainUsdcApy = mainUsdcSamples.reduce(
    (max, sample) => Math.max(max, sample.apyPercent),
    0
  );
  const maxStaticBenchmarkApy = HISTORICAL_APY_STATIC_BENCHMARKS.reduce(
    (max, series) => Math.max(max, series.fixedApyBps / 100),
    0
  );
  const maxBenchmarkApy = Math.max(maxMainUsdcApy, maxStaticBenchmarkApy);
  const axisStep = niceCeilStep(Math.max(maxApy, maxBenchmarkApy, 1) / 7);
  const levelCount = Math.max(
    2,
    Math.ceil(Math.max(maxApy, maxBenchmarkApy) / axisStep) + 1
  );
  const axisMax = axisStep * (levelCount - 1);
  const plotRange = EARN_CHART_BASELINE - EARN_CHART_TOP;
  const plot = (value: number) =>
    EARN_CHART_BASELINE - (value / axisMax) * plotRange;
  const xForIndex = (index: number) =>
    (index / Math.max(samples.length - 1, 1)) * EARN_CHART_WIDTH;
  const gridLines = Array.from({ length: levelCount }, (_, level) => {
    const value = axisStep * level;
    const y = plot(value);
    return {
      label: `${value.toFixed(2)}%`,
      level,
      topPercent: (y / EARN_CHART_HEIGHT) * 100,
    };
  });
  const linePath = samples
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"}${xForIndex(index)},${plot(
          sample.apyPercent
        )}`
    )
    .join(" ");
  const xForObservedAtMs = (observedAtMs: number) => {
    const startedAtMs = samples[0]?.observedAtMs ?? 0;
    const endedAtMs = samples.at(-1)?.observedAtMs ?? startedAtMs;
    if (endedAtMs <= startedAtMs) {
      return 0;
    }
    const progress = Math.min(
      Math.max((observedAtMs - startedAtMs) / (endedAtMs - startedAtMs), 0),
      1
    );
    return progress * EARN_CHART_WIDTH;
  };
  const mainUsdcBenchmark =
    mainUsdcSamples.length > 0
      ? (() => {
          const fallbackApyPercent = mainUsdcSamples.at(-1)?.apyPercent ?? 0;
          const path = mainUsdcSamples
            .map(
              (sample, index) =>
                `${index === 0 ? "M" : "L"}${xForObservedAtMs(
                  sample.observedAtMs
                )},${plot(sample.apyPercent)}`
            )
            .join(" ");
          const hoverObservedAtMs =
            hoverIndex === null
              ? samples.at(-1)?.observedAtMs
              : samples[Math.min(hoverIndex, samples.length - 1)]?.observedAtMs;
          const apyPercentAtHover =
            hoverObservedAtMs === undefined
              ? fallbackApyPercent
              : nearestHistoricalApyPercent(
                  mainUsdcSamples,
                  hoverObservedAtMs,
                  fallbackApyPercent
                );
          const y = plot(apyPercentAtHover);

          return {
            apyPercentAtHover,
            color: "#2688EB",
            d: path,
            key: "mainUsdcReserve" as const,
            label: "Main Market USDC",
            samples: mainUsdcSamples,
            topPercent: (y / EARN_CHART_HEIGHT) * 100,
          };
        })()
      : null;
  const benchmarkLines: HistoricalApyBenchmarkLine[] = [
    ...(mainUsdcBenchmark ? [mainUsdcBenchmark] : []),
    ...HISTORICAL_APY_STATIC_BENCHMARKS.map((series) => {
      const apyPercent = series.fixedApyBps / 100;
      const y = plot(apyPercent);
      return {
        apyPercentAtHover: apyPercent,
        color: series.color,
        d: `M0,${y}L${EARN_CHART_WIDTH},${y}`,
        key: series.key as Exclude<EarnComparisonSeriesKey, "loyal">,
        label: series.label,
        topPercent: (y / EARN_CHART_HEIGHT) * 100,
      };
    }),
  ];
  const mainUsdcBenchmarkLine =
    benchmarkLines.find((series) => series.key === "mainUsdcReserve") ??
    benchmarkLines[0];
  const midpointIndex = Math.floor((samples.length - 1) / 2);
  const axisDates = [
    samples[0].date,
    samples[midpointIndex].date,
    samples[samples.length - 1].date,
  ];
  const hoveredSample =
    hoverIndex === null
      ? null
      : samples[Math.min(hoverIndex, samples.length - 1)];
  const hoveredApyDelta =
    hoveredSample === null
      ? 0
      : hoveredSample.apyPercent -
        (mainUsdcBenchmarkLine?.apyPercentAtHover ?? 0);
  const hoverLeft =
    hoveredSample === null
      ? 0
      : (xForIndex(Math.min(hoverIndex ?? 0, samples.length - 1)) /
          EARN_CHART_WIDTH) *
        100;
  const tooltipLeft = Math.min(Math.max(hoverLeft, 16), 84);
  const hoverTop =
    hoveredSample === null
      ? 0
      : (plot(hoveredSample.apyPercent) / EARN_CHART_HEIGHT) * 100;

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    setHoverIndex(Math.round((x / rect.width) * (samples.length - 1)));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "2px 0",
        position: "relative",
        width: "100%",
      }}
    >
      <style jsx>{`
        .historical-chart-reveal-rect {
          animation: historical-chart-reveal 0.7s cubic-bezier(0.2, 0, 0, 1)
            both;
          transform-origin: 0 0;
        }
        .historical-chart-hover-elements {
          animation: historical-chart-hover-fade 0.18s ease both;
        }
        @keyframes historical-chart-reveal {
          0% {
            transform: scaleX(0);
          }
          100% {
            transform: scaleX(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .historical-chart-hover-elements,
          .historical-chart-reveal-rect {
            animation: none;
          }
        }
        @keyframes historical-chart-hover-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>

      <div style={{ display: "flex", gap: "8px", width: "100%" }}>
        <div
          onPointerLeave={() => setHoverIndex(null)}
          onPointerMove={handlePointerMove}
          style={{
            flex: 1,
            height: `${EARN_CHART_HEIGHT}px`,
            minWidth: 0,
            position: "relative",
          }}
        >
          <svg
            aria-label="Historical APY chart"
            preserveAspectRatio="none"
            role="img"
            style={{ display: "block", height: "100%", width: "100%" }}
            viewBox={`0 0 ${EARN_CHART_WIDTH} ${EARN_CHART_HEIGHT}`}
          >
            <defs>
              <clipPath
                clipPathUnits="userSpaceOnUse"
                id="historical-chart-reveal-clip"
              >
                <rect
                  className="historical-chart-reveal-rect"
                  height={EARN_CHART_HEIGHT}
                  width={EARN_CHART_WIDTH}
                  x={0}
                  y={0}
                />
              </clipPath>
            </defs>
            <g clipPath="url(#historical-chart-reveal-clip)">
              <path
                d={linePath}
                fill="none"
                stroke={LOYAL_EARN_BRAND_COLOR}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
              {benchmarkLines.map((series) => (
                <path
                  d={series.d}
                  fill="none"
                  key={series.key}
                  stroke={series.color}
                  strokeDasharray="6 6"
                  strokeLinecap="round"
                  strokeOpacity={0.4}
                  strokeWidth={1.5}
                />
              ))}
            </g>
          </svg>

          {hoveredSample ? (
            <>
              <div
                aria-hidden="true"
                className="historical-chart-hover-elements"
                style={{
                  borderLeft: "1px dashed rgba(60, 60, 67, 0.18)",
                  height: `${(plotRange / EARN_CHART_HEIGHT) * 100}%`,
                  left: `${hoverLeft}%`,
                  pointerEvents: "none",
                  position: "absolute",
                  top: `${(EARN_CHART_TOP / EARN_CHART_HEIGHT) * 100}%`,
                }}
              />
              <span
                aria-hidden="true"
                className="historical-chart-hover-elements"
                style={{
                  background: LOYAL_EARN_BRAND_COLOR,
                  borderRadius: "9999px",
                  boxShadow: "0 0 0 2px #fff",
                  height: "8px",
                  left: `${hoverLeft}%`,
                  pointerEvents: "none",
                  position: "absolute",
                  top: `${hoverTop}%`,
                  transform: "translate(-50%, -50%)",
                  width: "8px",
                }}
              />
              {benchmarkLines.map((series) => (
                <span
                  aria-hidden="true"
                  className="historical-chart-hover-elements"
                  key={series.key}
                  style={{
                    background: series.color,
                    borderRadius: "9999px",
                    boxShadow: "0 0 0 2px #fff",
                    height: "8px",
                    left: `${hoverLeft}%`,
                    pointerEvents: "none",
                    position: "absolute",
                    top: `${series.topPercent}%`,
                    transform: "translate(-50%, -50%)",
                    width: "8px",
                  }}
                />
              ))}
              <div
                className="historical-chart-hover-elements"
                style={{
                  background: "#F5F5F5",
                  borderRadius: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  left: `${tooltipLeft}%`,
                  padding: "8px 12px",
                  pointerEvents: "none",
                  position: "absolute",
                  top: "8px",
                  transform: "translateX(-50%)",
                  width: "194px",
                }}
              >
                <span
                  style={{
                    color: secondary,
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 400,
                    lineHeight: "16px",
                  }}
                >
                  {hoveredSample.date}
                </span>
                <span
                  style={{
                    color: "#000",
                    fontFamily: font,
                    fontSize: "20px",
                    fontWeight: 600,
                    lineHeight: "24px",
                  }}
                >
                  {hoveredSample.apyPercent.toFixed(2)}%
                </span>
                <span
                  style={{
                    color:
                      hoveredApyDelta >= 0
                        ? POSITIVE_AMOUNT_COLOR
                        : LOYAL_EARN_BRAND_COLOR,
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 400,
                    lineHeight: "16px",
                  }}
                >
                  {formatHistoricalApyDelta(
                    hoveredApyDelta,
                    mainUsdcBenchmarkLine?.label
                  )}
                </span>
                {benchmarkLines.map((series) => (
                  <div
                    key={series.key}
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: "6px",
                      paddingTop: "6px",
                    }}
                  >
                    <span
                      style={{
                        background: series.color,
                        borderRadius: "3px",
                        flexShrink: 0,
                        height: "10px",
                        width: "10px",
                      }}
                    />
                    <span
                      style={{
                        color: secondary,
                        fontFamily: font,
                        fontSize: "13px",
                        fontWeight: 400,
                        lineHeight: "16px",
                      }}
                    >
                      {`${series.label} (${formatEarnApyPercent(
                        Math.round(series.apyPercentAtHover * 100)
                      )})`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div
          aria-hidden="true"
          style={{
            height: `${EARN_CHART_HEIGHT}px`,
            position: "relative",
            width: "56px",
          }}
        >
          {gridLines.map((grid) => (
            <span
              key={grid.level}
              style={{
                color: "rgba(60, 60, 67, 0.4)",
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                position: "absolute",
                right: 0,
                top: `${grid.topPercent}%`,
                transform: "translateY(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {grid.label}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingRight: "56px",
          paddingTop: "8px",
          width: "100%",
        }}
      >
        {axisDates.map((date, index) => (
          <span
            key={`${date}-${index}`}
            style={{
              color: "rgba(60, 60, 67, 0.4)",
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              whiteSpace: "nowrap",
            }}
          >
            {date}
          </span>
        ))}
      </div>

      <div
        style={{
          columnGap: "16px",
          display: "flex",
          flexWrap: "wrap",
          paddingRight: "56px",
          paddingTop: "16px",
          rowGap: "8px",
          width: "100%",
        }}
      >
        {[
          {
            color: LOYAL_EARN_BRAND_COLOR,
            key: "loyal",
            label: "Loyal Earn",
          },
          ...benchmarkLines.map((series) => ({
            color: series.color,
            key: series.key,
            label: series.label,
          })),
        ].map((series) => (
          <div
            key={series.key}
            style={{ alignItems: "center", display: "flex", gap: "6px" }}
          >
            <span
              style={{
                background: series.color,
                borderRadius: "3px",
                height: "10px",
                width: "10px",
              }}
            />
            <span
              style={{
                color: series.key === "loyal" ? "#000" : secondary,
                fontFamily: font,
                fontSize: "13px",
                fontWeight: series.key === "loyal" ? 500 : 400,
                lineHeight: "16px",
                whiteSpace: "nowrap",
              }}
            >
              {series.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DepositChart({
  apy = FALLBACK_EARN_APY,
  isBalanceHidden = false,
  mainUsdcReserveApyBps = 559,
  principal = 1000,
}: {
  apy?: EarnForecastApy;
  isBalanceHidden?: boolean;
  mainUsdcReserveApyBps?: number;
  principal?: number;
}) {
  const points = useMemo(
    () =>
      buildEarnComparisonPoints(principal, apy, {
        mainUsdcReserve: mainUsdcReserveApyBps,
      }),
    [apy, mainUsdcReserveApyBps, principal]
  );
  const defaultHoverIndex = Math.floor((points.length - 1) / 2);
  const [hoverIndex, setHoverIndex] = useState(defaultHoverIndex);

  const loyalApyBps = getEarnComparisonApyBps(apy.apyBps, null);
  const loyalTarget = principal * getEarnForecastTargetMultiplier(loyalApyBps);
  const minValue = principal;
  const axisStep = niceCeilStep(Math.max(loyalTarget - principal, 1) / 4);
  const maxValue = minValue + axisStep * 4;
  const plotRange = EARN_CHART_BASELINE - EARN_CHART_TOP;
  const plot = (value: number) =>
    EARN_CHART_BASELINE -
    ((value - minValue) / (maxValue - minValue)) * plotRange;
  const xForIndex = (index: number) =>
    (index / (points.length - 1)) * EARN_CHART_WIDTH;

  const gridLines = Array.from({ length: 5 }, (_, level) => {
    const value = minValue + axisStep * level;
    const y = plot(value);
    return {
      label: `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      level,
      topPercent: (y / EARN_CHART_HEIGHT) * 100,
      y,
    };
  });

  const seriesPaths = EARN_COMPARISON_SERIES.map((series) => ({
    ...series,
    d: points
      .map((point, index) => {
        const x = xForIndex(index);
        const y = plot(point.values[series.key]);
        return `${index === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" "),
  }));

  const hoverPoint = points[Math.min(hoverIndex, points.length - 1)];
  const hoverLeft = (xForIndex(hoverPoint.index) / EARN_CHART_WIDTH) * 100;
  const tooltipLeft = Math.min(Math.max(hoverLeft, 21), 79);
  const pointTop = (value: number) => (plot(value) / EARN_CHART_HEIGHT) * 100;
  const loyalValue = hoverPoint.values.loyal;
  const loyalGain = loyalValue - principal;
  const staticSeries = EARN_COMPARISON_SERIES.filter(
    (series) => series.key !== "loyal"
  );
  const axisDates = [
    points[0].date,
    points[defaultHoverIndex].date,
    points[points.length - 1].date,
  ];

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const nextIndex = Math.round((x / rect.width) * (points.length - 1));
    setHoverIndex(nextIndex);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
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

      <div style={{ display: "flex", gap: "8px", width: "100%" }}>
        <div
          onPointerLeave={() => setHoverIndex(defaultHoverIndex)}
          onPointerMove={handlePointerMove}
          style={{
            flex: 1,
            height: `${EARN_CHART_HEIGHT}px`,
            minWidth: 0,
            position: "relative",
          }}
        >
          <svg
            aria-label="Projected earnings comparison chart"
            preserveAspectRatio="none"
            role="img"
            style={{ display: "block", height: "100%", width: "100%" }}
            viewBox={`0 0 ${EARN_CHART_WIDTH} ${EARN_CHART_HEIGHT}`}
          >
            <defs>
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
              {seriesPaths.map((series) => (
                <path
                  d={series.d}
                  fill="none"
                  key={series.key}
                  stroke={series.color}
                  strokeDasharray={series.dashed ? "6 6" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={series.dashed ? 0.4 : undefined}
                  strokeWidth={series.dashed ? 1.5 : 2}
                />
              ))}
            </g>
          </svg>

          <div
            aria-hidden="true"
            className="earn-chart-hover-elements"
            style={{
              borderLeft: "1px dashed rgba(60, 60, 67, 0.18)",
              height: `${(plotRange / EARN_CHART_HEIGHT) * 100}%`,
              left: `${hoverLeft}%`,
              pointerEvents: "none",
              position: "absolute",
              top: `${(EARN_CHART_TOP / EARN_CHART_HEIGHT) * 100}%`,
            }}
          />

          {EARN_COMPARISON_SERIES.map((series) => (
            <span
              aria-hidden="true"
              className="earn-chart-hover-elements"
              key={series.key}
              style={{
                background: series.color,
                borderRadius: "9999px",
                boxShadow: "0 0 0 2px #fff",
                height: "8px",
                left: `${hoverLeft}%`,
                pointerEvents: "none",
                position: "absolute",
                top: `${pointTop(hoverPoint.values[series.key])}%`,
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
              gap: "2px",
              left: `${tooltipLeft}%`,
              overflow: "hidden",
              padding: "8px 12px",
              pointerEvents: "none",
              position: "absolute",
              top: "8px",
              transform: "translateX(-50%)",
              width: "194px",
            }}
          >
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                paddingBottom: "8px",
              }}
            >
              {hoverPoint.date}
            </span>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "2px" }}
            >
              <div
                style={{ alignItems: "center", display: "flex", gap: "6px" }}
              >
                <span
                  style={{
                    background: LOYAL_EARN_BRAND_COLOR,
                    borderRadius: "3px",
                    height: "10px",
                    width: "10px",
                  }}
                />
                <span
                  style={{
                    color: "#000",
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 500,
                    lineHeight: "16px",
                  }}
                >
                  Loyal Earn ({formatEarnApyPercent(loyalApyBps)})
                </span>
              </div>
              <span
                style={{
                  color: isBalanceHidden ? "#BBBBC0" : "#000",
                  filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                  fontFamily: font,
                  fontSize: "20px",
                  fontWeight: 600,
                  lineHeight: "24px",
                  transition: "filter 0.15s ease, color 0.15s ease",
                  userSelect: isBalanceHidden ? "none" : "auto",
                }}
              >
                ${formatMoney(loyalValue).split(".")[0]}
                <span
                  style={{
                    color: isBalanceHidden
                      ? "#BBBBC0"
                      : "rgba(60, 60, 67, 0.4)",
                  }}
                >
                  .{formatMoney(loyalValue).split(".")[1]}
                </span>
              </span>
              <span
                style={{
                  color: isBalanceHidden ? "#BBBBC0" : POSITIVE_AMOUNT_COLOR,
                  filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  transition: "filter 0.15s ease, color 0.15s ease",
                  userSelect: isBalanceHidden ? "none" : "auto",
                }}
              >
                +${formatMoney(loyalGain)}
              </span>
            </div>

            {staticSeries.map((series) => {
              const seriesApyBps = getEarnComparisonApyBps(
                apy.apyBps,
                series.key === "mainUsdcReserve"
                  ? mainUsdcReserveApyBps
                  : series.fixedApyBps
              );
              const seriesValue = hoverPoint.values[series.key];
              return (
                <div
                  key={series.key}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <div style={{ padding: "6px 0" }}>
                    <div
                      style={{
                        background: "rgba(0, 0, 0, 0.08)",
                        height: "1px",
                        width: "100%",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        background: series.color,
                        borderRadius: "3px",
                        flexShrink: 0,
                        height: "10px",
                        width: "10px",
                      }}
                    />
                    <span
                      style={{
                        color: secondary,
                        fontFamily: font,
                        fontSize: "13px",
                        fontWeight: 400,
                        lineHeight: "16px",
                      }}
                    >
                      {series.label} ({formatEarnApyPercent(seriesApyBps)})
                    </span>
                  </div>
                  <span
                    style={{
                      color: isBalanceHidden ? "#BBBBC0" : "#000",
                      filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                      fontFamily: font,
                      fontSize: "13px",
                      fontWeight: 600,
                      lineHeight: "16px",
                      transition: "filter 0.15s ease, color 0.15s ease",
                      userSelect: isBalanceHidden ? "none" : "auto",
                    }}
                  >
                    ${formatMoney(seriesValue).split(".")[0]}
                    <span
                      style={{
                        color: isBalanceHidden
                          ? "#BBBBC0"
                          : "rgba(60, 60, 67, 0.4)",
                      }}
                    >
                      .{formatMoney(seriesValue).split(".")[1]}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          aria-hidden="true"
          style={{
            height: `${EARN_CHART_HEIGHT}px`,
            position: "relative",
            width: "40px",
          }}
        >
          {gridLines.map((grid) => (
            <span
              key={grid.level}
              style={{
                color: isBalanceHidden ? "#BBBBC0" : "rgba(60, 60, 67, 0.4)",
                filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 400,
                lineHeight: "16px",
                position: "absolute",
                right: 0,
                top: `${grid.topPercent}%`,
                transform: "translateY(-50%)",
                transition: "filter 0.15s ease, color 0.15s ease",
                userSelect: isBalanceHidden ? "none" : "auto",
                whiteSpace: "nowrap",
              }}
            >
              {grid.label}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingRight: "48px",
          paddingTop: "8px",
          width: "100%",
        }}
      >
        {axisDates.map((date) => (
          <span
            key={date}
            style={{
              color: "rgba(60, 60, 67, 0.4)",
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              whiteSpace: "nowrap",
            }}
          >
            {date}
          </span>
        ))}
      </div>

      <div
        style={{
          columnGap: "16px",
          display: "flex",
          flexWrap: "wrap",
          paddingRight: "48px",
          paddingTop: "16px",
          rowGap: "8px",
          width: "100%",
        }}
      >
        {EARN_COMPARISON_SERIES.map((series) => (
          <div
            key={series.key}
            style={{ alignItems: "center", display: "flex", gap: "6px" }}
          >
            <span
              style={{
                background: series.color,
                borderRadius: "3px",
                height: "10px",
                width: "10px",
              }}
            />
            <span
              style={{
                color: series.key === "loyal" ? "#000" : secondary,
                fontFamily: font,
                fontSize: "13px",
                fontWeight: series.key === "loyal" ? 500 : 400,
                lineHeight: "16px",
                whiteSpace: "nowrap",
              }}
            >
              {series.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EarnDepositView({
  isSubmitting = false,
  onClose,
  onDraftChange,
  onDraftSubmit,
  sources = FALLBACK_EARN_DEPOSIT_SOURCES,
  submitError = null,
}: {
  isSubmitting?: boolean;
  onClose?: () => void;
  onDraftChange?: (draft: EarnDepositDraft | null) => void;
  onDraftSubmit?: (draft: EarnDepositDraft) => void | Promise<void>;
  sources?: EarnDepositSourceOption[];
  submitError?: string | null;
}) {
  const earnForecastApy = useEarnForecastApy();
  const earnForecastApyHistory = useEarnForecastApyHistory();
  const mainUsdcReserveApyBps = deriveMainUsdcReserveForecastApyBps(
    earnForecastApyHistory
  );
  const earnApyLabel = formatEarnApyLabel(earnForecastApy.apyBps);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
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
  const [depositAmount, setDepositAmount] = useState(() =>
    formatBucksAmount(selectedSourceBalance)
  );
  const depositAmountTouchedRef = useRef(false);
  const [forecastSelection, setForecastSelection] =
    useState<ForecastAmountSelection>(() =>
      getDefaultForecastSelection(selectedSourceBalance)
    );
  const forecastSelectionTouchedRef = useRef(false);
  const numericDepositAmount =
    Number.parseFloat(depositAmount.replace(/,/g, "")) || 0;
  const forecastInputAmount =
    depositAmount.length > 0 ? numericDepositAmount : null;
  const forecastAmountOptions = useMemo(
    () =>
      buildForecastAmountOptions(selectedSourceBalance, forecastInputAmount),
    [forecastInputAmount, selectedSourceBalance]
  );
  const forecastAmount = getForecastAmountForSelection(
    forecastSelection,
    selectedSourceBalance,
    forecastInputAmount
  );
  const hasDepositAmount = depositAmount.length > 0;
  const isMaximumDepositMode = depositAmount.length === 0;
  const effectiveDepositAmount = isMaximumDepositMode
    ? selectedSourceBalance
    : numericDepositAmount;
  const effectiveDepositAmountLabel = isMaximumDepositMode
    ? formatDepositAmount(selectedSourceBalance)
    : depositAmount;
  const amountError =
    effectiveDepositAmount < MIN_DEPOSIT_USDC
      ? `Minimum deposit is ${MIN_DEPOSIT_USDC} USDC`
      : hasDepositAmount && numericDepositAmount > selectedSourceBalance
      ? "Insufficient balance"
      : null;
  const isDepositButtonDisabled = isSubmitting || amountError !== null;
  const depositButtonLabel = isSubmitting
    ? "Depositing..."
    : amountError ??
      `Deposit ${formatEarnActionCtaAmount(effectiveDepositAmount)} USDC`;
  const updateForecastFromInput = () => {
    forecastSelectionTouchedRef.current = true;
    setForecastSelection(
      hasUserForecastAmount(selectedSourceBalance) === null
        ? DEFAULT_FORECAST_AMOUNT
        : USER_FORECAST_SELECTION
    );
  };
  const handleChipClick = (selection: ForecastAmountSelection) => {
    forecastSelectionTouchedRef.current = true;
    setForecastSelection(selection);
  };
  const buildCurrentDraft = (): EarnDepositDraft => ({
    amount: effectiveDepositAmount,
    amountLabel: effectiveDepositAmountLabel,
    forecastApyBps: earnForecastApy.apyBps,
    source: selectedSource,
    symbol: "USDC",
    tokenDecimals: selectedSource.decimals,
    tokenMint: selectedSource.mint,
  });

  useEffect(() => {
    onDraftChange?.(null);
  }, [depositAmount, onDraftChange, selectedSource]);

  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);

  useEffect(() => {
    if (!depositAmountTouchedRef.current) {
      setDepositAmount(formatBucksAmount(selectedSourceBalance));
    }
  }, [selectedSourceBalance]);

  useEffect(() => {
    const defaultSelection = getDefaultForecastSelection(selectedSourceBalance);
    if (!forecastSelectionTouchedRef.current) {
      setForecastSelection(defaultSelection);
      return;
    }

    if (
      forecastSelection === USER_FORECAST_SELECTION &&
      defaultSelection !== USER_FORECAST_SELECTION
    ) {
      setForecastSelection(defaultSelection);
    }
  }, [forecastSelection, selectedSourceBalance]);

  useEffect(() => {
    if (!sourceOptions.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(
        sourceOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
      );
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
        .earn-deposit-submit:not(:disabled):hover {
          background: #222 !important;
        }
        .earn-forecast-chip {
          transition: background 0.15s ease, color 0.15s ease;
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
          <DepositVaultRow apyLabel={earnApyLabel} vault={TOP_DEPOSIT_VAULT} />
        </section>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
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
              {forecastAmountOptions.map((option) => {
                const isActive = option.selection === forecastSelection;
                return (
                  <button
                    className={`earn-forecast-chip ${
                      isActive ? "earn-forecast-chip-active" : ""
                    }`}
                    key={option.id}
                    onClick={() => handleChipClick(option.selection)}
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
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ padding: "12px", width: "100%" }}>
            <DepositChart
              apy={earnForecastApy}
              mainUsdcReserveApyBps={mainUsdcReserveApyBps}
              principal={forecastAmount}
            />
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
              onClick={() => {
                amountInputRef.current?.focus();
                amountInputRef.current?.select();
              }}
              style={{
                alignItems: "center",
                cursor: "text",
                display: "flex",
                gap: "4px",
                width: "100%",
              }}
            >
              <BucksAmountInput
                inputRef={amountInputRef}
                onValueChange={(rawValue) => {
                  const clampedValue = clampBucksAmountInput(
                    rawValue,
                    depositAmount,
                    selectedSource.balance
                  );
                  if (clampedValue !== null) {
                    depositAmountTouchedRef.current = true;
                    setDepositAmount(clampedValue);
                    updateForecastFromInput();
                  }
                }}
                value={depositAmount}
              />
            </div>
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
          <div
            style={{ display: "flex", flexDirection: "column", width: "100%" }}
          >
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
            <DepositSourceRow isStatic source={selectedSource} />
          </div>
        </section>
      </div>

      <div
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
          padding: "16px 32px 24px",
          width: "100%",
        }}
      >
        {submitError ? (
          <p
            style={{
              color: "#F9363C",
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "18px",
              margin: "0 0 10px",
            }}
          >
            {submitError}
          </p>
        ) : null}
        <button
          className="earn-deposit-submit"
          disabled={isDepositButtonDisabled}
          onClick={() => void onDraftSubmit?.(buildCurrentDraft())}
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
          {depositButtonLabel}
        </button>
      </div>
    </div>
  );
}

const AUTODEPOSIT_AMOUNT_PRESETS = [100, 200, 500, 1000, 2000] as const;

function AutodepositAmountChips({
  onSelect,
  selectedValue,
}: {
  onSelect: (value: string) => void;
  selectedValue?: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: "8px",
        paddingBottom: "12px",
        width: "100%",
      }}
    >
      <style jsx>{`
        .autodeposit-chip:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .autodeposit-chip[aria-pressed="true"]:hover {
          background: #000 !important;
        }
        .autodeposit-chip:active {
          scale: 0.96;
        }
      `}</style>
      {AUTODEPOSIT_AMOUNT_PRESETS.map((preset) => {
        const value = String(preset);
        const isSelected = selectedValue === value;
        return (
          <button
            aria-pressed={isSelected}
            className="autodeposit-chip"
            key={preset}
            onClick={() => onSelect(value)}
            style={{
              background: isSelected ? "#000" : "rgba(0, 0, 0, 0.04)",
              border: "none",
              borderRadius: "9999px",
              color: isSelected ? "#fff" : secondary,
              cursor: "pointer",
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: "20px",
              padding: "6px 12px",
              transition: "background 0.15s ease, scale 0.1s ease",
              whiteSpace: "nowrap",
            }}
            type="button"
          >
            ${preset.toLocaleString("en-US")}
          </button>
        );
      })}
    </div>
  );
}

function AutodepositFrequencyField({
  nextPeriodLabel,
}: {
  nextPeriodLabel?: string | null;
}) {
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        className="autodeposit-freq-trigger"
        style={{
          alignItems: "center",
          background: "transparent",
          border: "none",
          borderRadius: "16px",
          display: "flex",
          overflow: "hidden",
          padding: "0 12px",
          textAlign: "left",
          transition: "background 0.15s ease",
          width: "100%",
        }}
      >
        <span style={{ display: "flex", padding: "6px 12px 6px 0" }}>
          <span
            style={{
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.04)",
              borderRadius: "12px",
              color: secondary,
              display: "flex",
              flexShrink: 0,
              height: "48px",
              justifyContent: "center",
              width: "48px",
            }}
          >
            <Clock size={24} strokeWidth={2} />
          </span>
        </span>
        <span
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "2px",
            minWidth: 0,
            padding: "10px 0",
          }}
        >
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 500,
              letterSpacing: "-0.176px",
              lineHeight: "20px",
            }}
          >
            Every month
          </span>
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
            }}
          >
            {nextPeriodLabel
              ? `Next period ${nextPeriodLabel}`
              : "Starting today"}
          </span>
        </span>
      </div>
    </div>
  );
}

// Green bar-chart "Earn" badge, drawn inline to match the design exactly
// without depending on an exported asset.
function AutodepositEarnIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        background: "#32B67C",
        borderRadius: "12px",
        flexShrink: 0,
        height: "48px",
        overflow: "hidden",
        position: "relative",
        width: "48px",
      }}
    >
      <span
        style={{
          background: "#fff",
          borderRadius: "2px",
          height: "16px",
          left: "8px",
          position: "absolute",
          top: "24px",
          width: "6px",
        }}
      />
      <span
        style={{
          background: "#fff",
          borderRadius: "2px",
          height: "32px",
          left: "21px",
          position: "absolute",
          top: "8px",
          width: "6px",
        }}
      />
      <span
        style={{
          background: "#fff",
          borderRadius: "2px",
          height: "24px",
          left: "34px",
          position: "absolute",
          top: "16px",
          width: "6px",
        }}
      />
    </span>
  );
}

function AutodepositSummaryRow({
  fraction,
  icon,
  title,
  whole,
}: {
  fraction: string;
  icon: ReactNode;
  title: string;
  whole: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        borderRadius: "16px",
        display: "flex",
        overflow: "hidden",
        padding: "0 12px",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>{icon}</div>
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
          {title}
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
          {whole}
          <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>
            .{fraction} USDC
          </span>
        </span>
      </div>
    </div>
  );
}

// Autodeposit setup / edit pane. Mirrors the Deposit pane structure (amount
// input + To/From rows + bottom button). `isEditing` flips the title button to
// "Save Autodeposit" and the amount is preset by `initialAmount`. Autodeposit
// is not wired yet — this drives a client-side demo flow only.
export function AutodepositSetupView({
  earnBalance = 0,
  earnVaultAddressLabel,
  initialAmount = "100",
  initialKeepAmount = "500",
  nextPeriodLabel,
  isEditing = false,
  mainSource,
  onBack,
  onDelete,
  onSubmit,
}: {
  earnBalance?: number;
  earnVaultAddressLabel?: string | null;
  initialAmount?: string;
  initialKeepAmount?: string;
  nextPeriodLabel?: string | null;
  isEditing?: boolean;
  mainSource?: EarnDepositSourceOption | null;
  onBack?: () => void;
  onDelete?: () => void;
  onSubmit?: (amount: string, keepAmount: string) => void;
}) {
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const [amount, setAmount] = useState(initialAmount);
  const [keepAmount, setKeepAmount] = useState(initialKeepAmount);
  const earnBalanceLabel = formatMoney(earnBalance);
  const [earnWhole, earnFraction = "00"] = earnBalanceLabel.split(".");
  const keepAmountLabel = Number(keepAmount || 0).toLocaleString("en-US");
  const hasAmount = Number(amount) > 0;
  const normalizeAutodepositAmount = (value: string) =>
    Number(value.replace(/,/g, "")) || 0;
  const amountChanged =
    normalizeAutodepositAmount(amount) !==
    normalizeAutodepositAmount(initialAmount);
  const keepAmountChanged =
    normalizeAutodepositAmount(keepAmount) !==
    normalizeAutodepositAmount(initialKeepAmount);
  const hasChanges = !isEditing || amountChanged || keepAmountChanged;
  const canSubmit = hasAmount && hasChanges;
  const submitLabel = !hasAmount
    ? "Enter amount"
    : isEditing
    ? !hasChanges
      ? "No changes yet"
      : amountChanged && keepAmountChanged
      ? "Update Autodeposit"
      : amountChanged
      ? "Update monthly allowance"
      : "Update minimum balance"
    : "Create Autodeposit";

  const focusAmount = () => {
    amountInputRef.current?.focus();
    amountInputRef.current?.select();
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(focusAmount);
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
        .autodeposit-back:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .autodeposit-delete:hover {
          background: rgba(249, 54, 60, 0.22) !important;
        }
        .autodeposit-submit:not(:disabled):hover {
          background: #222 !important;
        }
        .autodeposit-amount-input::placeholder {
          color: rgba(60, 60, 67, 0.4);
          opacity: 1;
        }
      `}</style>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: "8px",
          padding: "16px 20px 8px",
        }}
      >
        <button
          aria-label="Back"
          className="autodeposit-back"
          onClick={onBack}
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
          <ArrowLeft size={24} strokeWidth={2} />
        </button>
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
          Autodeposit
        </h2>
        {isEditing && onDelete ? (
          <button
            className="autodeposit-delete"
            onClick={onDelete}
            style={{
              alignItems: "center",
              background: "rgba(249, 54, 60, 0.14)",
              border: "none",
              borderRadius: "9999px",
              color: LOYAL_EARN_BRAND_COLOR,
              cursor: "pointer",
              display: "inline-flex",
              flexShrink: 0,
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 500,
              justifyContent: "center",
              lineHeight: "20px",
              padding: "6px 16px",
              transition: "background 0.15s ease",
              whiteSpace: "nowrap",
            }}
            type="button"
          >
            Delete
          </button>
        ) : null}
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
            padding: "22px 20px 0",
            width: "100%",
          }}
        >
          <p
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              margin: 0,
              padding: "0 0 4px",
            }}
          >
            Allowance
          </p>
          <div
            onClick={focusAmount}
            style={{
              alignItems: "baseline",
              cursor: "text",
              display: "flex",
              gap: "8px",
              padding: "8px 0",
            }}
          >
            <input
              className="autodeposit-amount-input"
              inputMode="numeric"
              onChange={(event) => {
                const next = event.target.value
                  .replace(/[^0-9]/g, "")
                  .replace(/^0+(?=\d)/, "")
                  .slice(0, 9);
                setAmount(next);
              }}
              placeholder="0"
              ref={amountInputRef}
              style={{
                background: "transparent",
                border: "none",
                color: "#000",
                fontFamily: font,
                fontSize: "40px",
                fontWeight: 600,
                letterSpacing: "0",
                lineHeight: "48px",
                minWidth: 0,
                outline: "none",
                padding: 0,
                width: `${Math.max(amount.length, 1)}ch`,
              }}
              type="text"
              value={amount}
            />
            <span
              style={{
                color: "rgba(60, 60, 67, 0.4)",
                fontFamily: font,
                fontSize: "28px",
                fontWeight: 600,
                letterSpacing: "0",
                lineHeight: "32px",
                whiteSpace: "nowrap",
              }}
            >
              USDC
            </span>
          </div>
        </section>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
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
              Frequency
            </p>
          </div>
          <AutodepositFrequencyField nextPeriodLabel={nextPeriodLabel} />
        </section>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
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
              To
            </p>
          </div>
          <AutodepositSummaryRow
            fraction={earnFraction}
            icon={<EarnYieldIcon size={48} />}
            title={
              earnVaultAddressLabel ? `Earn · ${earnVaultAddressLabel}` : "Earn"
            }
            whole={earnWhole}
          />
        </section>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
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
          <AutodepositSummaryRow
            fraction={mainSource?.balanceFraction ?? "00"}
            icon={
              mainSource?.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  aria-hidden="true"
                  src={mainSource.icon}
                  style={{
                    borderRadius: "12px",
                    flexShrink: 0,
                    height: "48px",
                    objectFit: "cover",
                    width: "48px",
                  }}
                />
              ) : (
                <AutodepositEarnIcon />
              )
            }
            title={
              mainSource?.addressLabel
                ? `Main Account · ${mainSource.addressLabel}`
                : "Main Account"
            }
            whole={mainSource?.balanceWhole ?? "0"}
          />
        </section>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
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
              Minimum balance
            </p>
          </div>
          <div style={{ padding: "4px 0 0" }}>
            <div
              style={{
                alignItems: "center",
                border: "1px solid rgba(0, 0, 0, 0.08)",
                borderRadius: "16px",
                display: "flex",
                height: "60px",
                overflow: "hidden",
                padding: "0 12px",
                width: "100%",
              }}
            >
              <span
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  flex: 1,
                  minWidth: 0,
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
                  {keepAmountLabel}
                  <span style={{ color: "rgba(60, 60, 67, 0.4)" }}> USDC</span>
                </span>
              </span>
            </div>
          </div>
          <div style={{ padding: "12px 0 0" }}>
            <AutodepositAmountChips
              onSelect={setKeepAmount}
              selectedValue={keepAmount}
            />
          </div>
        </section>
      </div>

      <div
        style={{
          background:
            "linear-gradient(to bottom, rgba(255, 255, 255, 0), #fff 28%)",
          padding: "16px 20px 24px",
          width: "100%",
        }}
      >
        <button
          className="autodeposit-submit"
          disabled={!canSubmit}
          onClick={() => onSubmit?.(amount, keepAmount)}
          style={{
            alignItems: "center",
            background: canSubmit ? "#000" : "rgba(0, 0, 0, 0.06)",
            border: "none",
            borderRadius: "9999px",
            color: canSubmit ? "#fff" : secondary,
            cursor: canSubmit ? "pointer" : "default",
            display: "flex",
            fontFamily: font,
            fontSize: "16px",
            fontWeight: canSubmit && !isEditing ? 400 : 500,
            justifyContent: "center",
            lineHeight: "20px",
            padding: "12px 16px",
            transition: "background 0.15s ease",
            width: "100%",
          }}
          type="button"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
