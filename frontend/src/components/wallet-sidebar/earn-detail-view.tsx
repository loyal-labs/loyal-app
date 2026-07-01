"use client";

import NumberFlow, { continuous } from "@number-flow/react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleHelp,
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

import { DogWithMood } from "@/components/chat-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FALLBACK_EARN_FORECAST,
  formatEarnApyLabel,
  formatEarnApyPercent,
  getEarnForecastTargetMultiplier,
  type EarnForecastApy,
  type EarnForecastApyHistoryResponse,
} from "@/lib/kamino/earn-forecast.shared";
import { getTokenIconUrl } from "@/lib/token-icon";
import { resolveEarnDetailHeaderActionMode } from "@/lib/yield-optimization/earn-cleanup-ui-state";
import { resolveEarnTransactionMarketIcon } from "@/lib/yield-optimization/earn-position-display";
import type {
  EarnEarningsBar,
  EarnEarningsResponse,
  EarningsRangeId,
} from "@/lib/yield-optimization/earnings.shared";
import type { LoadedEarnAutodepositScheduledSweep } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import type { ActiveEarnPositionHolding } from "@/hooks/use-active-earn-position";
import { useEarnEarnings } from "@/hooks/use-earn-earnings";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import { useEarnForecastApyHistory } from "@/hooks/use-earn-forecast-apy-history";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const decimalGray = "rgba(60, 60, 67, 0.4)";
const POSITIVE_AMOUNT_COLOR = "#34C759";
const LOYAL_EARN_BRAND_COLOR = "#F9363C";
// USDC mark badged onto the Main Account icon when a row reflects only the
// account's USDC balance (deposit/withdraw/autodeposit), so it isn't confused
// with the account's full multi-token value. Mirrors the shielded-asset badge.
const USDC_BADGE_ICON_URL = getTokenIconUrl("USDC");

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
const USDC_RAW_SCALE = BigInt(1_000_000);
const USDC_DISPLAY_DUST_TOLERANCE = 1.5 / Number(USDC_RAW_SCALE);
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const EARN_NUMBER_FLOW_PLUGINS = [continuous];
const MOBILE_EARN_FORM_MEDIA_QUERY = "(max-width: 760px)";
const EARN_CLEANUP_MASCOT_TEXT =
  "You've already withdrawn the USDC. I can close the remaining Earn accounts and refund rent where possible.";
const FALLBACK_EARN_APY = {
  apyBps: FALLBACK_EARN_FORECAST.apyBps,
  rangeHighBps: FALLBACK_EARN_FORECAST.rangeHighBps,
  rangeLowBps: FALLBACK_EARN_FORECAST.rangeLowBps,
} as const satisfies EarnForecastApy;

function shouldAutoFocusEarnFormInput() {
  if (typeof window.matchMedia !== "function") {
    return true;
  }

  return !window.matchMedia(MOBILE_EARN_FORM_MEDIA_QUERY).matches;
}

export type EarnHelpTopic =
  | "autodeposit"
  | "autodepositDelete"
  | "autodepositDestination"
  | "autodepositLoadError"
  | "autodepositLoading"
  | "autodepositPending"
  | "autodepositSetup"
  | "autodepositSource"
  | "autodepositThreshold"
  | "currentPositions"
  | "earn";

type EarnHelpTooltipContext = {
  autodepositFloorLabel?: string;
  hasEarnPosition?: boolean;
  mainAccountLabel?: string;
};

function getEarnHelpTooltip(
  topic: EarnHelpTopic,
  {
    autodepositFloorLabel,
    hasEarnPosition = false,
    mainAccountLabel = "your Main Account",
  }: EarnHelpTooltipContext
): string {
  if (topic === "autodeposit") {
    return hasEarnPosition
      ? `Autodeposit keeps ${
          autodepositFloorLabel ?? "your chosen minimum"
        } in ${mainAccountLabel}. When extra USDC arrives, it moves the surplus into Earn so it does not sit idle.`
      : `Autodeposit turns on after your first Earn deposit. It keeps your chosen minimum in ${mainAccountLabel}, then moves extra USDC into Earn when it arrives.`;
  }

  if (topic === "autodepositPending") {
    return "Autodeposit is almost ready. Finish the recurring allowance approval so future surplus USDC can move into Earn automatically.";
  }

  if (topic === "autodepositSetup") {
    return hasEarnPosition
      ? `Set up Autodeposit to watch ${mainAccountLabel}. It will keep your chosen minimum there and move extra USDC into Earn.`
      : "Autodeposit becomes available after your first Earn deposit. Then it can keep a minimum in Main Account and move future surplus into Earn.";
  }

  if (topic === "autodepositLoading") {
    return "Loyal is checking your Autodeposit settings and allowance status. This card updates when the latest state loads.";
  }

  if (topic === "autodepositLoadError") {
    return "Loyal could not load Autodeposit settings. Retry refreshes the status without moving funds or changing your setup.";
  }

  if (topic === "autodepositThreshold") {
    return `This is the minimum USDC Autodeposit leaves in ${mainAccountLabel}. Only the balance above this amount is moved into Earn.`;
  }

  if (topic === "autodepositSource") {
    return `From is the account Autodeposit watches. New USDC arrives in ${mainAccountLabel}, and Autodeposit leaves your minimum there.`;
  }

  if (topic === "autodepositDestination") {
    return "To is your Earn account. Surplus USDC from Main Account moves here so Loyal can route it into the current Earn target.";
  }

  if (topic === "autodepositDelete") {
    return "Delete turns off future Autodeposit sweeps. It does not withdraw USDC already in Earn.";
  }

  if (topic === "earn") {
    return "Earn is your USDC earning position. Loyal routes deposited USDC into the current Earn target and shows the live balance plus APY here.";
  }

  return "Current positions shows where your Earn USDC is sitting right now. Market rows are deployed for yield; Idle Balance is USDC not currently deployed into a market.";
}

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
  source: EarnWithdrawSourceOption;
  symbol: "USDC";
  tokenDecimals: number;
};

export type EarnWithdrawSourceOption = {
  amountRaw: string;
  balance: number;
  id: string;
  icon: string;
  label: string;
  liquidityMint: string;
  market: string | null;
  reserve: string | null;
  sourceId: string;
  supplyApyBps?: string | null;
  tokenAccount: string | null;
  type: "reserve" | "idle";
};

export type EarnAutodepositDraft = {
  amount: number;
  amountLabel: string;
  amountChanged?: boolean;
  existingPolicySeed?: string;
  existingRecurringDelegation?: string;
  expiryTimestamp?: bigint;
  keepAmount: number;
  keepAmountChanged?: boolean;
  keepAmountLabel: string;
  nonce: bigint;
  periodLengthSeconds?: bigint;
  requiresSignature?: boolean;
  source: EarnDepositSourceOption;
  startTimestamp?: bigint;
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

function snapDollarDisplayDust(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const nearestCent = Math.round(value * 100) / 100;
  return Math.abs(value - nearestCent) <= USDC_DISPLAY_DUST_TOLERANCE
    ? nearestCent
    : value;
}

function formatDepositAmount(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  });
}

// Renders the full entered amount. The 6-digit ceiling only absorbs float
// noise — typed input is already capped at USDC's 6 on-chain decimals.
export function formatEarnActionCtaAmount(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  });
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

// Sanitizes free-form amount typing. This helper never compares against a
// balance: deposit inputs allow over-balance amounts (the submit button
// switches to "Insufficient balance"), while the withdraw input clamps to the
// max withdrawable amount at its call site.
export function sanitizeBucksAmountInput(
  rawValue: string,
  previousValue: string
) {
  if (rawValue === "") {
    return "";
  }

  // A lone dot in an empty field starts a decimal entry as "0.".
  if (rawValue === ".") {
    return "0.";
  }

  if (!/^[\d,]*\.?\d*$/.test(rawValue)) {
    return null;
  }

  // Backspace collapses a stranded trailing dot so deleting "8.83" walks
  // 8.8 -> 8 -> "" in one press per symbol instead of pausing on "8.".
  const isDeletion = rawValue.length < previousValue.length;
  const nextValue = (
    isDeletion && rawValue.endsWith(".") ? rawValue.slice(0, -1) : rawValue
  ).replace(/^0+(?=\d)/, "");

  // USDC carries 6 on-chain decimals; anything finer can't be transferred.
  const decimals = nextValue.split(".")[1] ?? "";
  if (decimals.length > 6) {
    return null;
  }

  if (nextValue.split(".")[0].replace(/,/g, "").length > 9) {
    return null;
  }

  return nextValue;
}

// Splits a typed amount so the fractional part can render muted, matching the
// gray fraction of the total balance in the portfolio pane.
function splitBucksAmountParts(value: string) {
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1) {
    return { fraction: "", whole: value };
  }

  return { fraction: value.slice(dotIndex), whole: value.slice(0, dotIndex) };
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
    label: "Main Kamino USDC",
  },
  {
    color: "#8E8E93",
    dashed: true,
    fixedApyBps: 365,
    key: "tBill",
    label: "T-Bill",
  },
];

// Design palette/labels shared by the reworked APY + Forecast charts (Figma
// file YTJOPpIYC7FEctch7b43Jz). EARN_COMPARISON_SERIES above keeps the legacy
// colors still used by the deposit sheet chart.
const EARN_SERIES_DISPLAY: Record<
  EarnComparisonSeriesKey,
  { color: string; label: string }
> = {
  loyal: { color: LOYAL_EARN_BRAND_COLOR, label: "Loyal Earn" },
  mainUsdcReserve: { color: "#A7B3F6", label: "Main Kamino" },
  tBill: { color: "#B1B1B4", label: "T-Bill" },
};

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

// 48px Main Account icon with a small USDC badge at the bottom-right. Used in
// flows where the amount next to it is the account's USDC-only balance, so the
// same wallet icon isn't mistaken for the full multi-token account value.
function MainAccountUsdcIcon({ src }: { src: string }) {
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        src={src}
        style={{
          borderRadius: "12px",
          height: "48px",
          objectFit: "cover",
          width: "48px",
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        src={USDC_BADGE_ICON_URL}
        style={{
          border: "2px solid #fff",
          borderRadius: "9999px",
          bottom: "-14px",
          boxSizing: "border-box",
          height: "28px",
          position: "absolute",
          right: "-12px",
          width: "28px",
        }}
      />
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
  tone,
  withIcon = false,
}: {
  dark?: boolean;
  onClick?: () => void;
  tone?: "black" | "red" | "subtle";
  withIcon?: boolean;
}) {
  const resolvedTone = tone ?? (dark ? "black" : "subtle");
  const isFilled = resolvedTone === "black" || resolvedTone === "red";
  const background =
    resolvedTone === "red"
      ? "#F9363C"
      : resolvedTone === "black"
      ? "#000"
      : "rgba(0, 0, 0, 0.04)";
  const hoverBackground =
    resolvedTone === "red"
      ? "#e72f34"
      : resolvedTone === "black"
      ? "#222"
      : "rgba(0, 0, 0, 0.08)";

  return (
    <>
      <style jsx>{`
        .earn-detail-deposit {
          transition: background 0.15s ease, transform 0.15s ease;
        }
        .earn-detail-deposit:hover {
          background: ${hoverBackground} !important;
          transform: translateY(-1px);
        }
        .earn-detail-deposit:active {
          transform: translateY(0);
        }
      `}</style>
      <button
        className="earn-detail-deposit"
        onClick={onClick}
        style={{
          alignItems: "center",
          background,
          border: "none",
          borderRadius: "9999px",
          color: isFilled ? "#fff" : "#000",
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
  baseAmount,
  isHidden = false,
}: {
  baseAmount: number;
  isHidden?: boolean;
}) {
  const displayValue = snapDollarDisplayDust(baseAmount);

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
        @media (max-width: 760px) {
          :global(.earn-growing-balance-flow) {
            font-size: clamp(30px, 9.5vw, 40px);
            line-height: 1.08;
          }
        }
      `}</style>
      <NumberFlow
        className="earn-growing-balance-flow"
        format={{
          maximumFractionDigits: EARN_BALANCE_DECIMALS,
          minimumFractionDigits: EARN_BALANCE_DECIMALS,
          useGrouping: true,
        }}
        opacityTiming={{ duration: 0, easing: "linear" }}
        plugins={EARN_NUMBER_FLOW_PLUGINS}
        prefix="$"
        spinTiming={{ duration: 0, easing: "linear" }}
        transformTiming={{ duration: 0, easing: "linear" }}
        trend={1}
        value={displayValue}
      />
    </>
  );
}

// Past-day bars top out slightly below the dashed "today" bar (295/300 in the
// Figma spec) so the in-progress day always reads as the full-height cap.
const EARNINGS_BAR_MAX_FRACTION = 295 / 300;
const EARNINGS_BAR_MIN_HEIGHT_PX = 4;
const EARNINGS_MONTHLY_RANGE_ID = "1Y" satisfies EarningsRangeId;
const EARNINGS_DAILY_RANGE_ID = "30D" satisfies EarningsRangeId;
const EARNINGS_BAR_COLOR = "rgba(52, 199, 89, 0.6)";
const EARNINGS_BAR_HOVER_COLOR = "rgba(52, 199, 89, 0.16)";
const EARNINGS_TODAY_BAR_BORDER_COLOR = "rgba(0, 0, 0, 0.24)";
const EARNINGS_TODAY_BAR_HOVER_FILL =
  "linear-gradient(180deg, rgba(52, 199, 89, 0.6) 0%, rgba(52, 199, 89, 0) 100%)";

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

function deriveLiveEarnedUsd({
  apyBps,
  generatedAt,
  nowMs = Date.now(),
  principalAmount,
}: {
  apyBps: number;
  generatedAt: string | null;
  nowMs?: number;
  principalAmount: number;
}) {
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const elapsedSeconds = Number.isFinite(generatedAtMs)
    ? Math.max(0, (nowMs - generatedAtMs) / 1000)
    : 0;

  return getEarningsRatePerSecond(apyBps, principalAmount) * elapsedSeconds;
}

function normalizeDisplayedEarnedUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Number(value.toFixed(EARN_BALANCE_DECIMALS));
}

export function deriveEstimatedEarnedSummaryAmount({
  apyBps,
  earningsData,
  earningsError,
  generatedAt,
  nowMs,
  principalAmount,
}: {
  apyBps: number;
  earningsData: EarnEarningsResponse | null;
  earningsError: string | null;
  generatedAt: string | null;
  nowMs?: number;
  principalAmount: number;
}) {
  if (earningsError || !earningsData) {
    return 0;
  }

  const lifetimeEarnedUsd = Number.isFinite(earningsData.lifetimeEarnedUsd)
    ? earningsData.lifetimeEarnedUsd
    : 0;
  const estimatedLifetimeEarnedUsd =
    lifetimeEarnedUsd +
    deriveLiveEarnedUsd({
      apyBps,
      generatedAt,
      nowMs,
      principalAmount,
    });

  // A fresh RPC balance can include an Autodeposit sweep before the confirmed
  // principal history catches up. Treating balance - principal as earned in
  // that window turns new deposits into yield, so use the APY/history path as
  // the display authority.
  return normalizeDisplayedEarnedUsd(estimatedLifetimeEarnedUsd);
}

export function formatEarnedSummaryLabel(value: number) {
  return formatSignedEarningsAmount(value);
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

function splitEarningsHeaderValue(value: number): {
  fraction: string;
  whole: string;
} {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const [whole, fraction] = safeValue
    .toLocaleString("en-US", {
      maximumFractionDigits: EARN_BALANCE_DECIMALS,
      minimumFractionDigits: EARN_BALANCE_DECIMALS,
    })
    .split(".");
  return { fraction, whole };
}

function formatMaxDailyEarningsLabel(value: number) {
  if (!Number.isFinite(value) || value < 0.01) {
    return "<$0.01";
  }
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
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

// Indeterminate ring spinner that echoes the landing -> app splash loader (faint
// track + accent arc), minus the dog logo. Shown while the Earned chart is still
// fetching its bars.
function EarningsChartLoader() {
  const SIZE = 56;
  const STROKE = 5;
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.25;
  return (
    <div
      aria-label="Loading earnings"
      role="status"
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        display: "flex",
        flex: 1,
        justifyContent: "center",
        minHeight: 0,
        width: "100%",
      }}
    >
      <span
        className="animate-spin"
        style={{ display: "inline-flex", height: SIZE, width: SIZE }}
      >
        <svg
          aria-hidden="true"
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            fill="none"
            r={radius}
            stroke="rgba(18, 18, 18, 0.08)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            fill="none"
            r={radius}
            stroke={LOYAL_EARN_BRAND_COLOR}
            strokeDasharray={`${arc} ${circumference - arc}`}
            strokeLinecap="round"
            strokeWidth={STROKE}
          />
        </svg>
      </span>
    </div>
  );
}

function EarningsBlock({
  apy,
  earningsData,
  estimatedEarnedUsd,
  forecastPrincipalAmount,
  isBalanceHidden = false,
  isEarningsLoading = false,
  principalAmount,
}: {
  apy: EarnForecastApy;
  earningsData: EarnEarningsResponse | null;
  estimatedEarnedUsd: number;
  forecastPrincipalAmount: number;
  isBalanceHidden?: boolean;
  isEarningsLoading?: boolean;
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
  const forecastAmount = forecastPrincipalAmount;
  const placeholderBars = useMemo(
    () =>
      principalAmount > 0
        ? buildPlaceholderEarningsBars(EARNINGS_DAILY_RANGE_ID)
        : EMPTY_EARNINGS_BARS,
    [principalAmount]
  );
  const realBars = earningsData?.bars ?? EMPTY_EARNINGS_BARS;
  const hasRealBars = realBars.length > 0;
  // Show the loader only while we have nothing real to paint yet; cached/persisted
  // bars revalidating in the background keep rendering instead of flashing a spinner.
  const showEarningsLoader = isEarningsLoading && !hasRealBars;
  const bars = hasRealBars ? realBars : placeholderBars;
  // Each bar carries the amount earned within that day. Reconcile the current
  // in-progress bar against the live estimate without turning prior bars into
  // cumulative values.
  const dailyBars = useMemo(() => {
    const safeEstimatedEarnedUsd = Math.max(0, estimatedEarnedUsd);
    const nonCurrentRecordedEarnedUsd = bars.reduce(
      (sum, bar) => (bar.isCurrent ? sum : sum + Math.max(0, bar.earnedUsd)),
      0
    );
    const currentResidualEarnedUsd = Math.max(
      0,
      safeEstimatedEarnedUsd - nonCurrentRecordedEarnedUsd
    );
    const reconciledBars = bars.map((bar) =>
      bar.isCurrent
        ? {
            ...bar,
            earnedUsd: Math.max(0, bar.earnedUsd, currentResidualEarnedUsd),
          }
        : bar
    );
    return reconciledBars;
  }, [bars, estimatedEarnedUsd]);
  const maxDailyEarnedUsd = useMemo(
    () =>
      dailyBars.reduce(
        (max, bar) => (bar.isCurrent ? max : Math.max(max, bar.earnedUsd)),
        0
      ),
    [dailyBars]
  );
  const hoveredBarEntry =
    hoveredBar !== null ? dailyBars[hoveredBar] ?? null : null;
  const hoveredApyBps = hoveredBarEntry
    ? hoveredBarEntry.isCurrent
      ? earningsData?.currentApyBps ?? hoveredBarEntry.apyBps
      : hoveredBarEntry.apyBps
    : null;
  const hoveredDateLabel = hoveredBarEntry
    ? hoveredBarEntry.isCurrent
      ? `Today, ${hoveredBarEntry.label}`
      : hoveredBarEntry.label
    : "";
  const headerValue = splitEarningsHeaderValue(
    hoveredBarEntry
      ? Math.max(0, hoveredBarEntry.earnedUsd)
      : estimatedEarnedUsd
  );
  let headerSubtitle: ReactNode;
  if (!hoveredBarEntry) {
    headerSubtitle = "";
  } else if (hoveredApyBps !== null) {
    headerSubtitle = `with ${formatEarnApyPercent(hoveredApyBps)} APY`;
  } else if (hoveredBarEntry.isCurrent) {
    headerSubtitle = `${hoveredBarEntry.label}, Now`;
  } else {
    headerSubtitle = hoveredDateLabel;
  }
  // The hovered date renders next to the scale label only while the subtitle
  // slot is occupied by the APY line.
  const hoveredDateRowLabel =
    hoveredBarEntry && hoveredApyBps !== null ? hoveredDateLabel : "";

  return (
    <section
      className="earnings-block"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px",
        width: "100%",
      }}
    >
      <style jsx>{`
        .earnings-bar {
          align-items: flex-end;
          background: transparent;
          border: none;
          cursor: pointer;
          display: flex;
          flex: 1 0 0;
          height: 100%;
          min-width: 0;
          padding: 0;
        }
        .earnings-bar-fill {
          border-radius: 4px;
          box-sizing: border-box;
          display: block;
          transform-origin: center bottom;
          animation: earnings-bar-rise 0.55s cubic-bezier(0.2, 0, 0, 1) both;
          animation-delay: calc(var(--bar-index, 0) * 14ms);
          transition: background 0.18s ease, border-color 0.18s ease;
          width: 100%;
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
          transition: opacity 0.34s cubic-bezier(0.2, 0, 0, 1),
            transform 0.34s cubic-bezier(0.2, 0, 0, 1),
            filter 0.34s cubic-bezier(0.2, 0, 0, 1);
        }
        @media (max-width: 760px) {
          .earnings-block {
            padding: 4px 8px 8px !important;
          }

          .earnings-tabs-row {
            padding: 0 0 8px !important;
          }

          .earnings-tabs {
            gap: 4px !important;
          }

          .earnings-tab-button {
            flex: 1 1 0;
            min-width: 0;
            padding: 6px 8px !important;
            text-align: center;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .earnings-bar-fill {
            animation: none;
          }
          .earnings-tab-panel {
            transition: none;
          }
        }
      `}</style>

      <div
        className="earnings-tabs-row"
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
          className="earnings-tabs"
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
                className="earnings-tab-button"
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              padding: "4px 14px 0",
              width: "100%",
            }}
          >
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              padding: "4px 14px 0",
              width: "100%",
            }}
          >
            <ForecastChart
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
              height: "100%",
              padding: "4px 14px 0",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                paddingBottom: "8px",
                width: "100%",
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "6px",
                  minWidth: 0,
                }}
              >
                <p
                  style={{
                    color: isBalanceHidden ? "#BBBBC0" : "#000",
                    filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                    fontFamily: font,
                    fontSize: "28px",
                    fontWeight: 600,
                    lineHeight: "32px",
                    margin: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {`$${headerValue.whole}`}
                  <span
                    style={{
                      color: isBalanceHidden ? "#BBBBC0" : decimalGray,
                    }}
                  >
                    {`.${headerValue.fraction}`}
                  </span>
                </p>
                <EarnSectionHelpTrigger
                  ariaLabel="About earned amount"
                  tooltip="Total amount earned in the last 30 days."
                />
              </div>
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  height: "16px",
                  lineHeight: "16px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {headerSubtitle}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: font,
                fontSize: "13px",
                justifyContent: "space-between",
                lineHeight: "16px",
                paddingBottom: "8px",
                width: "100%",
              }}
            >
              <span style={{ color: secondary }}>{hoveredDateRowLabel}</span>
              <span
                style={{
                  color: secondary,
                  filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                }}
              >
                {formatMaxDailyEarningsLabel(maxDailyEarnedUsd)}
              </span>
            </div>
            <div
              key="earnings-bars-daily"
              onMouseLeave={() => setHoveredBar(null)}
              style={{
                alignItems: "flex-end",
                display: "flex",
                flex: "1 1 auto",
                gap: "8px",
                minHeight: 0,
                overflow: "hidden",
                width: "100%",
              }}
            >
              {showEarningsLoader ? (
                <EarningsChartLoader />
              ) : (
                dailyBars.map((bar, i) => {
                  const isActive = hoveredBar === i;
                  const fillPercent =
                    maxDailyEarnedUsd > 0
                      ? (Math.max(0, bar.earnedUsd) / maxDailyEarnedUsd) *
                        EARNINGS_BAR_MAX_FRACTION *
                        100
                      : 0;
                  return (
                    <button
                      aria-label={`${
                        bar.label
                      } earned ${formatSignedEarningsAmount(
                        Math.max(0, bar.earnedUsd)
                      )}`}
                      className="earnings-bar"
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
                        style={
                          bar.isCurrent
                            ? {
                                background: isActive
                                  ? EARNINGS_TODAY_BAR_HOVER_FILL
                                  : "transparent",
                                border: `1px dashed ${
                                  isActive
                                    ? EARNINGS_BAR_COLOR
                                    : EARNINGS_TODAY_BAR_BORDER_COLOR
                                }`,
                                height: "100%",
                              }
                            : {
                                background: isActive
                                  ? EARNINGS_BAR_HOVER_COLOR
                                  : EARNINGS_BAR_COLOR,
                                height: `${fillPercent.toFixed(2)}%`,
                                minHeight: `${EARNINGS_BAR_MIN_HEIGHT_PX}px`,
                              }
                        }
                      />
                    </button>
                  );
                })
              )}
              {dailyBars.length === 0 && !showEarningsLoader ? (
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
            <div
              style={{
                display: "flex",
                fontFamily: font,
                fontSize: "13px",
                justifyContent: "space-between",
                lineHeight: "16px",
                paddingTop: "8px",
                width: "100%",
              }}
            >
              <span style={{ color: secondary, whiteSpace: "nowrap" }}>
                {dailyBars[0]?.label ?? ""}
              </span>
              <span style={{ color: secondary, whiteSpace: "nowrap" }}>
                {dailyBars[dailyBars.length - 1]?.label ?? ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AutodepositToggle({
  disabled = false,
  isOn,
  isPending = false,
  onToggle,
}: {
  disabled?: boolean;
  isOn: boolean;
  isPending?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      aria-busy={isPending}
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
        padding: "2px",
        transition: "background 0.2s ease",
        width: "51px",
      }}
      type="button"
    >
      <span
        style={{
          alignItems: "center",
          background: "#fff",
          borderRadius: "9999px",
          boxShadow: "0 3px 8px rgba(0, 0, 0, 0.15)",
          display: "inline-flex",
          height: "27px",
          justifyContent: "center",
          // 51px track - 2x2px padding - 27px knob = 20px of travel.
          transform: isOn ? "translateX(20px)" : "translateX(0)",
          transition: "transform 0.2s ease",
          width: "27px",
        }}
      >
        {isPending ? (
          <span
            aria-hidden="true"
            className="autodeposit-toggle-spinner"
            style={{
              border: "2px solid rgba(120, 120, 128, 0.25)",
              borderRadius: "9999px",
              borderTopColor: LOYAL_EARN_BRAND_COLOR,
              display: "inline-block",
              height: "16px",
              width: "16px",
            }}
          />
        ) : null}
      </span>
      <style jsx>{`
        .autodeposit-toggle-spinner {
          animation: autodeposit-toggle-spin 0.6s linear infinite;
        }
        @keyframes autodeposit-toggle-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .autodeposit-toggle-spinner {
            animation-duration: 1.1s;
          }
        }
      `}</style>
    </button>
  );
}

function formatScheduledSweepAmount(rawAmount: string): string {
  if (!/^\d+$/.test(rawAmount)) {
    return "$0.00";
  }

  const raw = BigInt(rawAmount);
  const whole = raw / USDC_RAW_SCALE;
  const cents = (raw % USDC_RAW_SCALE) / BigInt(10_000);

  return `$${whole.toLocaleString("en-US")}.${cents
    .toString()
    .padStart(2, "0")}`;
}

function formatRawUsdcAmount(rawAmount: string) {
  if (!/^\d+$/.test(rawAmount)) {
    return formatForecastMoney(0, true);
  }

  return formatForecastMoney(Number(BigInt(rawAmount)) / 1_000_000, true);
}

function createWithdrawSourceOptions(
  holdings: ActiveEarnPositionHolding[] | undefined
): EarnWithdrawSourceOption[] {
  const positiveHoldings =
    holdings?.filter((holding) => {
      try {
        return BigInt(holding.amountRaw) > BigInt(0);
      } catch {
        return false;
      }
    }) ?? [];
  const hasReserveHolding = positiveHoldings.some(
    (holding) => holding.kind === "kamino"
  );
  const eligibleHoldings = hasReserveHolding
    ? positiveHoldings.filter((holding) => holding.kind === "kamino")
    : positiveHoldings;
  const options = eligibleHoldings.map((holding): EarnWithdrawSourceOption => {
    const tokenAccount =
      typeof holding.provenance.tokenAccount === "string"
        ? holding.provenance.tokenAccount
        : null;
    const sourceId =
      holding.kind === "idle"
        ? tokenAccount ?? holding.liquidityMint
        : holding.reserve ?? holding.liquidityMint;
    return {
      amountRaw: holding.amountRaw,
      balance: Number(BigInt(holding.amountRaw)) / 1_000_000,
      id: `${holding.kind}:${sourceId}`,
      icon: resolveEarnTransactionMarketIcon({ market: holding.market }),
      label:
        holding.kind === "idle"
          ? "Idle vault USDC"
          : `${holding.marketName} reserve`,
      liquidityMint: holding.liquidityMint,
      market: holding.market,
      reserve: holding.reserve,
      sourceId,
      supplyApyBps: holding.supplyApyBps,
      tokenAccount,
      type: holding.kind === "idle" ? "idle" : "reserve",
    };
  });

  return options;
}

function formatScheduledSweepTime(eligibleAfter: string): string {
  const date = new Date(eligibleAfter);
  if (Number.isNaN(date.getTime())) {
    return "Scheduled";
  }

  return date.toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

function getScheduledSweepSourceLabel(classification: string): string {
  switch (classification) {
    case "initial_surplus":
      return "Initial surplus";
    case "floor_rebaseline":
      return "Balance update";
    case "simple_inbound":
      return "Incoming USDC";
    case "complex_defi":
      return "DeFi activity";
    case "earn_withdrawal":
      return "Earn withdrawal";
    case "explicit_redeposit":
      return "Manual redeposit";
    default:
      return "Wallet surplus";
  }
}

function AutodepositCard({
  floorAccountLabel = "your wallet",
  floorLabel,
  hasCurrentPosition = false,
  isBalanceHidden = false,
  isConfigured = false,
  isPendingSetup = false,
  scheduledSweeps = [],
  state = "idle",
  onDisable,
  helpTooltip,
  onSetUp,
}: {
  floorAccountLabel?: string;
  floorLabel?: string;
  hasCurrentPosition?: boolean;
  isBalanceHidden?: boolean;
  isConfigured?: boolean;
  isPendingSetup?: boolean;
  scheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  state?:
    | "closing"
    | "created"
    | "creating"
    | "idle"
    | "paused"
    | "pausing"
    | "resuming";
  onDisable?: () => void;
  helpTooltip?: string;
  onSetUp?: () => void;
}) {
  const isBusy = state === "creating" || state === "closing";
  const isToggling = state === "pausing" || state === "resuming";
  const visibleScheduledSweeps = scheduledSweeps.slice(0, 3);
  const statusLabel =
    state === "creating"
      ? "Creating allowance and policy"
      : state === "closing"
      ? "Removing allowance and refunding rent"
      : state === "pausing"
      ? "Pausing…"
      : state === "resuming"
      ? "Resuming…"
      : state === "paused"
      ? "Paused"
      : `Keeps ${
          floorLabel ?? "$0"
        } in ${floorAccountLabel}, moves the rest to the best earn position`;
  // Only the configured Smart Account status carries balance numbers; the
  // creating/closing/pausing/resuming/paused statuses are plain text and must
  // not blur.
  const statusLabelHasAmount = !isBusy && !isToggling && state !== "paused";
  const renderTitleWithHelp = (title: string) => (
    <span
      className="earn-autodeposit-title-line"
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: "8px",
        maxWidth: "100%",
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
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      <EarnSectionHelpTrigger
        ariaLabel="About Autodeposit"
        tooltip={helpTooltip}
      />
    </span>
  );

  if (isConfigured || isPendingSetup) {
    const cardStatusLabel = isPendingSetup
      ? "Finish setup to approve the recurring allowance"
      : statusLabel;
    const cardTitle = isPendingSetup
      ? "Finish Autodeposit setup"
      : "Autodeposit";
    return (
      <>
        <style jsx>{`
          .earn-autodeposit-btn {
            transition: background 0.15s ease, transform 0.15s ease;
          }
          .earn-autodeposit-btn:hover {
            background: #e72f34 !important;
            transform: translateY(-1px);
          }
          .earn-autodeposit-btn:active {
            transform: translateY(0);
          }
          .earn-autodeposit-settings {
            transition: background 0.15s ease;
          }
          .earn-autodeposit-settings:hover {
            background: rgba(0, 0, 0, 0.06) !important;
          }
          .earn-autodeposit-title-line {
            align-items: center;
            display: inline-flex;
            gap: 6px;
            min-width: 0;
            max-width: 100%;
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
              {renderTitleWithHelp(cardTitle)}
              <span
                style={{
                  color:
                    isBalanceHidden && statusLabelHasAmount
                      ? "#BBBBC0"
                      : secondary,
                  filter:
                    isBalanceHidden && statusLabelHasAmount
                      ? "url(#rs-pixelate-sm)"
                      : "none",
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  transition: "filter 0.15s ease, color 0.15s ease",
                  userSelect:
                    isBalanceHidden && statusLabelHasAmount ? "none" : "auto",
                }}
              >
                {cardStatusLabel}
              </span>
            </div>
            {isPendingSetup ? (
              <button
                className="earn-autodeposit-btn"
                onClick={onSetUp}
                style={{
                  background: "#F9363C",
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
                Finish
              </button>
            ) : (
              <>
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
                  disabled={isBusy || isToggling}
                  // While toggling, the knob optimistically shows the target
                  // position; on failure the workspace reverts the state.
                  isOn={
                    isToggling
                      ? state === "resuming"
                      : !isBusy && state !== "paused"
                  }
                  isPending={isToggling}
                  onToggle={onDisable}
                />
              </>
            )}
          </div>
          {!isPendingSetup && visibleScheduledSweeps.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "0 12px 8px 68px",
              }}
            >
              {visibleScheduledSweeps.map((sweep) => (
                <div
                  key={sweep.id}
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "10px",
                    minHeight: "36px",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      flexDirection: "column",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        color: isBalanceHidden ? "#BBBBC0" : "#000",
                        filter: isBalanceHidden
                          ? "url(#rs-pixelate-sm)"
                          : "none",
                        fontFamily: font,
                        fontSize: "13px",
                        fontWeight: 500,
                        lineHeight: "16px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        transition: "filter 0.15s ease, color 0.15s ease",
                        userSelect: isBalanceHidden ? "none" : "auto",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatScheduledSweepAmount(sweep.remainingAmountRaw)}
                    </span>
                    <span
                      style={{
                        color: secondary,
                        fontFamily: font,
                        fontSize: "12px",
                        fontWeight: 400,
                        lineHeight: "15px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {getScheduledSweepSourceLabel(sweep.classification)}{" "}
                      pending
                    </span>
                  </div>
                  <span
                    style={{
                      color: secondary,
                      flexShrink: 0,
                      fontFamily: font,
                      fontSize: "12px",
                      fontWeight: 400,
                      lineHeight: "15px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatScheduledSweepTime(sweep.eligibleAfter)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
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
          background: #e72f34 !important;
          transform: translateY(-1px);
        }
        .earn-autodeposit-btn:active {
          transform: translateY(0);
        }
        .earn-autodeposit-title-line {
          align-items: center;
          display: inline-flex;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
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
            {renderTitleWithHelp("Autodeposit")}
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
          {hasCurrentPosition ? (
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
                  background: "#F9363C",
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
          ) : null}
        </div>
      </section>
    </>
  );
}

function EarnSectionHelpTrigger({
  ariaLabel,
  tooltip,
}: {
  ariaLabel: string;
  tooltip?: string;
}) {
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  if (!tooltip) {
    return null;
  }

  return (
    <Tooltip open={isTooltipOpen}>
      <style jsx>{`
        .earn-section-help-trigger {
          transition: color 0.15s ease, transform 0.15s ease;
        }
        .earn-section-help-trigger:hover,
        .earn-section-help-trigger:focus-visible {
          color: ${secondary} !important;
        }
        @media (max-width: 760px) {
          .earn-section-help-trigger {
            display: none !important;
          }
        }
      `}</style>
      <TooltipTrigger asChild>
        <button
          aria-label={ariaLabel}
          className="earn-section-help-trigger"
          onBlur={() => {
            setIsHighlighted(false);
            setIsTooltipOpen(false);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onFocus={() => {
            setIsHighlighted(true);
            setIsTooltipOpen(true);
          }}
          onMouseEnter={() => {
            setIsHighlighted(true);
            setIsTooltipOpen(true);
          }}
          onMouseLeave={() => {
            setIsHighlighted(false);
            setIsTooltipOpen(false);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsTooltipOpen(true);
          }}
          style={{
            alignItems: "center",
            background: "transparent",
            border: "none",
            color: isHighlighted ? secondary : decimalGray,
            cursor: "help",
            display: "inline-flex",
            flex: "0 0 auto",
            height: "20px",
            justifyContent: "center",
            padding: 0,
            transform: isHighlighted ? "translateY(-1px)" : "translateY(0)",
            width: "20px",
          }}
          type="button"
        >
          <CircleHelp aria-hidden="true" size={18} strokeWidth={2.1} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        style={{
          fontFamily: font,
          lineHeight: "18px",
          maxWidth: "280px",
          textAlign: "left",
        }}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export function EarnDetailView({
  autodepositFloorAccountLabel,
  autodepositFloorLabel,
  autodepositScheduledSweeps = [],
  autodepositState = "idle",
  currentBalanceAmount = 0,
  currentPositionHoldings,
  currentPositionMarketName = "Main Kamino",
  currentPositionTokenSymbol = "USDC",
  earningsCacheKey,
  earningsCacheScope,
  hasCleanupCandidate = false,
  hasCurrentPosition = false,
  isAutodepositConfigured = false,
  isAutodepositPending = false,
  isBalanceHidden = false,
  onDeposit,
  onDisableAutodeposit,
  onOpenAutodeposit,
  onWithdraw,
  principalAmount = 0,
}: {
  autodepositFloorAccountLabel?: string;
  autodepositFloorLabel?: string;
  autodepositScheduledSweeps?: LoadedEarnAutodepositScheduledSweep[];
  autodepositState?:
    | "closing"
    | "created"
    | "creating"
    | "idle"
    | "paused"
    | "pausing"
    | "resuming";
  currentBalanceAmount?: number;
  currentPositionHoldings?: ActiveEarnPositionHolding[];
  currentPositionMarketName?: string;
  currentPositionTokenSymbol?: string;
  currentSupplyApyBps?: string | null;
  earningsCacheKey?: string;
  earningsCacheScope?: {
    expectedPrincipalAmountRaw?: string | null;
    settingsPda?: string | null;
    solanaEnv?: string;
    walletAddress?: string | null;
  };
  hasCleanupCandidate?: boolean;
  hasCurrentPosition?: boolean;
  isAutodepositConfigured?: boolean;
  isAutodepositPending?: boolean;
  isBalanceHidden?: boolean;
  onDeposit?: () => void;
  onDisableAutodeposit?: () => void;
  onOpenAutodeposit?: () => void;
  onWithdraw?: () => void;
  principalAmount?: number;
}) {
  const earnForecastApy = useEarnForecastApy();
  const hasPositiveCurrentBalance =
    hasCurrentPosition && currentBalanceAmount > 0;
  const {
    data: earningsRangeSet,
    error: earningsError,
    isLoading: isEarningsLoading,
  } = useEarnEarnings({
    cacheKey: earningsCacheKey,
    enabled: hasPositiveCurrentBalance,
    expectedPrincipalAmountRaw: earningsCacheScope?.expectedPrincipalAmountRaw,
    settingsPda: earningsCacheScope?.settingsPda,
    solanaEnv: earningsCacheScope?.solanaEnv,
    walletAddress: earningsCacheScope?.walletAddress,
  });
  const [earnLiveNowMs, setEarnLiveNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasCurrentPosition) {
      return;
    }

    setEarnLiveNowMs(Date.now());
    const interval = window.setInterval(
      () => setEarnLiveNowMs(Date.now()),
      EARN_BALANCE_SAMPLE_MS
    );
    return () => window.clearInterval(interval);
  }, [hasCurrentPosition]);
  const earningsData =
    earningsRangeSet?.ranges[EARNINGS_MONTHLY_RANGE_ID] ?? null;
  const earningsDailyData =
    earningsRangeSet?.ranges[EARNINGS_DAILY_RANGE_ID] ?? null;
  const mainAccountHelpLabel =
    autodepositFloorAccountLabel ?? "your Main Account";
  const helpTooltip = (topic: EarnHelpTopic) =>
    getEarnHelpTooltip(topic, {
      autodepositFloorLabel,
      hasEarnPosition: hasCurrentPosition,
      mainAccountLabel: mainAccountHelpLabel,
    });
  const estimatedEarnedAmountApyBps = deriveEstimatedEarnedAmountApyBps({
    earningsData,
    earningsError,
    fallbackApyBps: earnForecastApy.apyBps,
  });
  const visibleCurrentPositionHoldings =
    currentPositionHoldings?.filter((holding) => {
      try {
        return BigInt(holding.amountRaw) > BigInt(0);
      } catch {
        return false;
      }
    }) ?? [];
  const currentPositionRows =
    visibleCurrentPositionHoldings.length > 0
      ? visibleCurrentPositionHoldings.map((holding) => ({
          amount: formatRawUsdcAmount(holding.amountRaw),
          icon: resolveEarnTransactionMarketIcon({ market: holding.market }),
          key: `${holding.kind}:${holding.reserve ?? holding.liquidityMint}`,
          primary: holding.kind === "idle" ? holding.label : holding.marketName,
          secondary:
            holding.kind === "idle"
              ? holding.marketName
              : currentPositionTokenSymbol,
        }))
      : [
          {
            amount: formatForecastMoney(currentBalanceAmount, true),
            icon: TOP_EARN_VAULT.logo,
            key: "current-position",
            primary: currentPositionMarketName,
            secondary: currentPositionTokenSymbol,
          },
        ];
  const displayBalanceAmount = snapDollarDisplayDust(currentBalanceAmount);
  const forecastPrincipalAmount =
    hasCurrentPosition && currentBalanceAmount > 0
      ? currentBalanceAmount
      : principalAmount;
  const estimatedEarnedUsd = deriveEstimatedEarnedSummaryAmount({
    apyBps: estimatedEarnedAmountApyBps,
    earningsData,
    earningsError,
    generatedAt: earningsRangeSet?.generatedAt ?? null,
    nowMs: earnLiveNowMs,
    principalAmount,
  });
  const earnedSummaryLabel = formatEarnedSummaryLabel(estimatedEarnedUsd);
  const depositButtonTone =
    !hasCurrentPosition || isAutodepositConfigured ? "red" : "black";
  const headerActionMode = resolveEarnDetailHeaderActionMode({
    hasCleanupCandidate,
    hasCurrentPosition,
  });

  return (
    <div
      className="earn-detail-view scrollbar-hide"
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
        className="earn-detail-header"
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          justifyContent: "space-between",
          padding: "10px 20px 0",
        }}
      >
        <h2
          className="earn-detail-title"
          style={{
            alignItems: "center",
            color: "#000",
            display: "flex",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            gap: "8px",
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            transform: "translateY(-5px)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Earn
          </span>
          <EarnSectionHelpTrigger
            ariaLabel="About Earn"
            tooltip={helpTooltip("earn")}
          />
        </h2>
        <div
          className={`earn-detail-actions${
            headerActionMode === "deposit-only"
              ? " earn-detail-actions-single"
              : ""
          }`}
          style={{ display: "flex", gap: "8px" }}
        >
          {headerActionMode === "position" ? (
            <>
              <PositionHeaderButton
                icon="withdraw"
                iconColor="#85868A"
                label="Withdraw"
                onClick={onWithdraw}
              />
              <PositionHeaderButton
                icon="deposit"
                label="Deposit"
                onClick={onDeposit}
                tone={depositButtonTone}
              />
            </>
          ) : headerActionMode === "cleanup" ? (
            <>
              <PositionHeaderButton
                icon="withdraw"
                iconColor="#85868A"
                label="Close"
                onClick={onWithdraw}
              />
              <PositionHeaderButton
                icon="deposit"
                label="Deposit"
                onClick={onDeposit}
                tone={depositButtonTone}
              />
            </>
          ) : (
            <DepositButton
              onClick={onDeposit}
              tone={depositButtonTone}
              withIcon
            />
          )}
        </div>
      </div>

      <div
        className="earn-detail-balance-row"
        style={{
          alignItems: "center",
          borderRadius: "20px",
          display: "flex",
          flexShrink: 0,
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
            className="earn-detail-balance-amount"
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
                baseAmount={displayBalanceAmount}
                isHidden={isBalanceHidden}
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
              className="earn-detail-earned-label"
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

      <style jsx>{`
        @media (max-width: 760px) {
          .earn-detail-view {
            padding-bottom: calc(84px + env(safe-area-inset-bottom));
          }

          .earn-detail-header {
            align-items: stretch !important;
            background: linear-gradient(
              to bottom,
              rgba(255, 255, 255, 0),
              #fff 28%
            );
            bottom: 0;
            gap: 8px !important;
            left: 0;
            padding: 14px 16px calc(18px + env(safe-area-inset-bottom)) !important;
            position: fixed;
            right: 0;
            z-index: 45;
          }

          .earn-detail-title {
            display: none;
          }

          .earn-detail-actions {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            width: 100%;
          }

          .earn-detail-actions-single {
            grid-template-columns: minmax(0, 1fr);
          }

          :global(.earn-detail-actions .earn-detail-deposit),
          :global(.earn-detail-actions .earn-position-action) {
            justify-content: center !important;
            padding: 6px 12px !important;
            width: 100%;
          }

          :global(
              .earn-detail-actions
                .earn-position-action[data-earn-action="deposit"]
            ) {
            background: #f9363c !important;
            color: #fff !important;
          }

          :global(
              .earn-detail-actions
                .earn-position-action[data-earn-action="deposit"]:hover
            ) {
            background: #e72f34 !important;
          }

          .earn-detail-balance-row {
            border-radius: 0 !important;
            gap: 10px !important;
            padding: 8px 16px 2px !important;
          }

          .earn-detail-balance-amount {
            font-size: clamp(30px, 9.5vw, 40px) !important;
            line-height: 1.08 !important;
            min-width: 0;
          }
        }
      `}</style>

      {hasCurrentPosition ? <div style={{ height: "9px" }} /> : null}

      {hasCurrentPosition ? (
        <EarningsBlock
          apy={earnForecastApy}
          earningsData={earningsDailyData}
          estimatedEarnedUsd={estimatedEarnedUsd}
          forecastPrincipalAmount={forecastPrincipalAmount}
          isBalanceHidden={isBalanceHidden}
          isEarningsLoading={isEarningsLoading}
          principalAmount={principalAmount}
        />
      ) : null}

      <AutodepositCard
        floorAccountLabel={autodepositFloorAccountLabel}
        floorLabel={autodepositFloorLabel}
        hasCurrentPosition={hasCurrentPosition}
        isBalanceHidden={isBalanceHidden}
        isConfigured={isAutodepositConfigured}
        isPendingSetup={isAutodepositPending}
        scheduledSweeps={autodepositScheduledSweeps}
        state={autodepositState}
        helpTooltip={helpTooltip("autodeposit")}
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
                alignItems: "center",
                color: "#000",
                display: "inline-flex",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 600,
                gap: "8px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 8px",
              }}
            >
              <span>Current positions</span>
              <EarnSectionHelpTrigger
                ariaLabel="About current positions"
                tooltip={helpTooltip("currentPositions")}
              />
            </h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {currentPositionRows.map((row) => (
              <div
                key={row.key}
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
                  <VaultIcon logo={row.icon} />
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
                    {row.primary}
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
                    {row.secondary}
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
                  {row.amount}
                </span>
              </div>
            ))}
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
  tone,
}: {
  dark?: boolean;
  icon: "deposit" | "withdraw";
  iconColor?: string;
  label: string;
  onClick?: () => void;
  tone?: "black" | "red" | "subtle";
}) {
  const resolvedTone = tone ?? (dark ? "black" : "subtle");
  const isFilled = resolvedTone === "black" || resolvedTone === "red";
  const background =
    resolvedTone === "red"
      ? "#F9363C"
      : resolvedTone === "black"
      ? "#000"
      : "rgba(0, 0, 0, 0.04)";
  const hoverBackground =
    resolvedTone === "red"
      ? "#e72f34"
      : resolvedTone === "black"
      ? "#222"
      : "rgba(0, 0, 0, 0.08)";

  return (
    <>
      <style jsx>{`
        .earn-position-action {
          transition: background 0.15s ease, transform 0.15s ease;
        }
        .earn-position-action:hover {
          background: ${hoverBackground} !important;
          transform: translateY(-1px);
        }
        .earn-position-action:active {
          transform: translateY(0);
        }
      `}</style>
      <button
        className="earn-position-action"
        data-earn-action={icon}
        onClick={onClick}
        style={{
          alignItems: "center",
          background,
          border: "none",
          borderRadius: "9999px",
          color: isFilled ? "#fff" : "#000",
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
        overflow: "visible",
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
          <MainAccountUsdcIcon src={icon} />
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

function BucksAmountInput({
  inputRef,
  onValueChange,
  value,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onValueChange: (rawValue: string) => void;
  value: string;
}) {
  const { fraction, whole } = splitBucksAmountParts(value);
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
            the two-tone layer below stays aligned with the real input. */}
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
        {/* Visible two-tone layer: typed decimals render gray like the total
            balance fraction. The input above keeps its text transparent so
            this layer shows through while caret and selection stay native. */}
        {value ? (
          <span
            aria-hidden="true"
            style={{
              ...amountTextStyle,
              gridArea: "1 / 1",
              whiteSpace: "pre",
            }}
          >
            <span style={{ color: "#000" }}>{whole}</span>
            {fraction ? (
              <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>{fraction}</span>
            ) : null}
          </span>
        ) : null}
        <input
          className="bucks-amount-input"
          inputMode="decimal"
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="0"
          ref={inputRef}
          // size=1 keeps the input's intrinsic width from inflating the grid
          // track; the hidden replica alone sizes the cell, so the two-tone
          // layer stays flush under the typed digits.
          size={1}
          style={{
            ...amountTextStyle,
            background: "transparent",
            border: "none",
            caretColor: "#000",
            color: "transparent",
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
    </div>
  );
}

export function EarnWithdrawView({
  cleanupOnly = false,
  currentPositionHoldings,
  isSubmitting = false,
  onCleanupSubmit,
  onClose,
  onDraftChange,
  onDraftSubmit,
  onComplete,
  destinations = FALLBACK_EARN_DEPOSIT_SOURCES,
  submitError = null,
}: {
  cleanupOnly?: boolean;
  currentPositionHoldings?: ActiveEarnPositionHolding[];
  isSubmitting?: boolean;
  onCleanupSubmit?: () => void | Promise<void>;
  onClose?: () => void;
  onDraftChange?: (draft: EarnWithdrawDraft | null) => void;
  onDraftSubmit?: (draft: EarnWithdrawDraft) => void | Promise<void>;
  onComplete?: (withdrawal: {
    amount: number;
    mode: "partial" | "full";
  }) => void | Promise<void>;
  destinations?: EarnDepositSourceOption[];
  submitError?: string | null;
}) {
  const withdrawAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const destinationOptions =
    destinations.length > 0 ? destinations : FALLBACK_EARN_DEPOSIT_SOURCES;
  const sourceOptions = useMemo(
    () => createWithdrawSourceOptions(currentPositionHoldings),
    [currentPositionHoldings]
  );
  const [selectedSourceId, setSelectedSourceId] = useState(
    sourceOptions[0]?.id ?? ""
  );
  const [isSourceDropdownOpen, setIsSourceDropdownOpen] = useState(false);
  const selectedSource =
    sourceOptions.find((source) => source.id === selectedSourceId) ??
    sourceOptions[0] ??
    null;
  const alternateSourceOptions = sourceOptions.filter(
    (source) => source.id !== selectedSource?.id
  );
  const [selectedDestinationId, setSelectedDestinationId] = useState(
    destinationOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
  );
  const selectedDestination =
    destinationOptions.find((dest) => dest.id === selectedDestinationId) ??
    destinationOptions[0] ??
    FALLBACK_EARN_DEPOSIT_SOURCES[0];
  const hasWithdrawAmount = withdrawAmount.length > 0;
  const numericWithdrawAmount = Number(withdrawAmount.replace(/,/g, ""));
  const selectedSourceMaxAmount = selectedSource?.balance ?? 0;
  const effectiveWithdrawAmount = hasWithdrawAmount
    ? numericWithdrawAmount
    : selectedSourceMaxAmount;
  const effectiveWithdrawAmountLabel = hasWithdrawAmount
    ? withdrawAmount
    : formatDepositAmount(selectedSourceMaxAmount);
  const effectiveWithdrawMode =
    selectedSource?.type === "reserve"
      ? "partial"
      : deriveEarnWithdrawMode({
          amount: effectiveWithdrawAmount,
          maxWithdrawAmount: selectedSourceMaxAmount,
        });
  const withdrawAmountError = !selectedSource
    ? "No withdrawable Earn source"
    : !Number.isFinite(effectiveWithdrawAmount) || effectiveWithdrawAmount <= 0
    ? "Enter an amount"
    : hasWithdrawAmount && numericWithdrawAmount > selectedSourceMaxAmount
    ? "Insufficient balance"
    : null;
  const isWithdrawButtonDisabled = isSubmitting || withdrawAmountError !== null;
  const withdrawButtonLabel = isSubmitting
    ? "Withdrawing..."
    : withdrawAmountError ??
      `Withdraw $${formatEarnActionCtaAmount(effectiveWithdrawAmount)}`;
  const buildCurrentDraft = (): EarnWithdrawDraft => {
    if (!selectedSource) {
      throw new Error("No withdrawable Earn source was found.");
    }

    return {
      amount: effectiveWithdrawAmount,
      amountLabel: effectiveWithdrawAmountLabel,
      destination: selectedDestination,
      mode: effectiveWithdrawMode,
      source: selectedSource,
      symbol: "USDC",
      tokenDecimals: 6,
    };
  };

  useEffect(() => {
    if (
      selectedSourceId &&
      !sourceOptions.some((source) => source.id === selectedSourceId)
    ) {
      setSelectedSourceId(sourceOptions[0]?.id ?? "");
      setIsSourceDropdownOpen(false);
    }
  }, [selectedSourceId, sourceOptions]);

  useEffect(() => {
    if (!destinationOptions.some((dest) => dest.id === selectedDestinationId)) {
      setSelectedDestinationId(
        destinationOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
      );
    }
  }, [destinationOptions, selectedDestinationId]);

  useEffect(() => {
    onDraftChange?.(null);
  }, [onDraftChange, selectedDestination, selectedSource, withdrawAmount]);

  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      withdrawAmountInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const [cleanupMascotVisibleLength, setCleanupMascotVisibleLength] =
    useState(0);
  const cleanupMascotVisibleText = EARN_CLEANUP_MASCOT_TEXT.slice(
    0,
    cleanupMascotVisibleLength
  );
  const isCleanupMascotTextComplete =
    cleanupMascotVisibleLength >= EARN_CLEANUP_MASCOT_TEXT.length;

  useEffect(() => {
    if (!cleanupOnly) {
      setCleanupMascotVisibleLength(0);
      return;
    }

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setCleanupMascotVisibleLength(EARN_CLEANUP_MASCOT_TEXT.length);
      return;
    }

    setCleanupMascotVisibleLength(0);

    let index = 0;
    let intervalId: number | null = null;
    const startTimeoutId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        index = Math.min(EARN_CLEANUP_MASCOT_TEXT.length, index + 1);
        setCleanupMascotVisibleLength(index);

        if (index >= EARN_CLEANUP_MASCOT_TEXT.length && intervalId !== null) {
          window.clearInterval(intervalId);
        }
      }, 30);
    }, 240);

    return () => {
      window.clearTimeout(startTimeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [cleanupOnly]);

  if (cleanupOnly) {
    const isCleanupButtonDisabled = isSubmitting || !onCleanupSubmit;
    const cleanupButtonLabel = isSubmitting ? "Preparing..." : "Close policies";

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
          .earn-cleanup-submit:not(:disabled):hover {
            background: rgba(249, 54, 60, 0.2) !important;
          }
          @media (max-width: 760px) {
            .earn-withdraw-header {
              display: none !important;
            }
          }
          .earn-cleanup-mascot-note {
            align-items: flex-end;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 4px 0 0;
            width: 100%;
          }
          .earn-cleanup-mascot-bubble {
            animation: earn-cleanup-bubble-unravel 0.62s
              cubic-bezier(0.16, 1, 0.3, 1) 0.08s both;
            background: #fff;
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 18px;
            box-sizing: border-box;
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08),
              0 2px 6px rgba(0, 0, 0, 0.04);
            color: rgba(0, 0, 0, 0.86);
            font-family: ${font};
            font-size: 15px;
            font-weight: 500;
            line-height: 21px;
            max-width: 100%;
            padding: 12px 16px;
            position: relative;
            transform-origin: 100% 50%;
            width: 100%;
          }
          .earn-cleanup-mascot-bubble-content {
            display: block;
            position: relative;
          }
          .earn-cleanup-mascot-bubble-measure {
            display: block;
            visibility: hidden;
          }
          .earn-cleanup-mascot-bubble-stream {
            display: block;
            inset: 0;
            position: absolute;
            white-space: normal;
          }
          .earn-cleanup-mascot-bubble-cursor {
            animation: earn-cleanup-stream-cursor 0.8s step-end infinite;
            background: currentColor;
            border-radius: 9999px;
            display: inline-block;
            height: 1em;
            margin-left: 2px;
            transform: translateY(2px);
            width: 2px;
          }
          .earn-cleanup-mascot-bubble-cursor[data-complete="true"] {
            animation: none;
            opacity: 0;
          }
          .earn-cleanup-mascot-bubble::before {
            animation: earn-cleanup-bubble-tail 0.62s
              cubic-bezier(0.16, 1, 0.3, 1) 0.08s both;
            background: #fff;
            border-bottom: 1px solid rgba(0, 0, 0, 0.08);
            border-right: 1px solid rgba(0, 0, 0, 0.08);
            bottom: -6px;
            content: "";
            height: 11px;
            position: absolute;
            right: 34px;
            transform: rotate(45deg);
            width: 11px;
          }
          .earn-cleanup-mascot-dog {
            animation: earn-cleanup-dog-slide-in 0.5s
              cubic-bezier(0.16, 1, 0.3, 1) both;
            flex-shrink: 0;
            height: 70px;
            margin-right: 4px;
            width: 88px;
          }
          .earn-cleanup-mascot-dog :global(svg) {
            display: block;
            height: 100%;
            width: 100%;
          }
          @keyframes earn-cleanup-bubble-unravel {
            from {
              opacity: 0;
              transform: translateX(4px) scaleX(0.08);
            }
            to {
              opacity: 1;
              transform: translateX(0) scaleX(1);
            }
          }
          @keyframes earn-cleanup-bubble-tail {
            from {
              opacity: 0;
              transform: translateY(-3px) rotate(45deg) scale(0.3);
            }
            to {
              opacity: 1;
              transform: translateY(0) rotate(45deg) scale(1);
            }
          }
          @keyframes earn-cleanup-dog-slide-in {
            from {
              opacity: 0;
              transform: translateX(28px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
          @keyframes earn-cleanup-stream-cursor {
            0%,
            48% {
              opacity: 1;
            }
            49%,
            100% {
              opacity: 0;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .earn-cleanup-mascot-bubble,
            .earn-cleanup-mascot-bubble::before,
            .earn-cleanup-mascot-bubble-cursor,
            .earn-cleanup-mascot-dog {
              animation: none;
            }
          }
        `}</style>
        <div
          className="earn-withdraw-header"
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
            padding: "28px 20px 8px",
            scrollbarWidth: "none",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: "12px",
              padding: "8px 0 28px",
            }}
          >
            <EarnYieldIcon />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "14px",
                  lineHeight: "18px",
                }}
              >
                Earn balance
              </span>
              <span
                style={{
                  color: "#000",
                  fontFamily: font,
                  fontSize: "32px",
                  fontWeight: 600,
                  lineHeight: "38px",
                }}
              >
                $0
                <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
              </span>
            </div>
          </div>

          <div className="earn-cleanup-mascot-note">
            <div className="earn-cleanup-mascot-bubble">
              <span
                aria-label={EARN_CLEANUP_MASCOT_TEXT}
                className="earn-cleanup-mascot-bubble-content"
              >
                <span
                  aria-hidden="true"
                  className="earn-cleanup-mascot-bubble-measure"
                >
                  {EARN_CLEANUP_MASCOT_TEXT}
                </span>
                <span
                  aria-hidden="true"
                  className="earn-cleanup-mascot-bubble-stream"
                >
                  {cleanupMascotVisibleText}
                  <span
                    className="earn-cleanup-mascot-bubble-cursor"
                    data-complete={isCleanupMascotTextComplete}
                  />
                </span>
              </span>
            </div>
            <div className="earn-cleanup-mascot-dog">
              <DogWithMood nice />
            </div>
          </div>
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
            className="earn-cleanup-submit"
            disabled={isCleanupButtonDisabled}
            onClick={() => {
              void onCleanupSubmit?.();
            }}
            style={{
              alignItems: "center",
              background: isCleanupButtonDisabled
                ? "rgba(0, 0, 0, 0.04)"
                : "rgba(249, 54, 60, 0.14)",
              border: "none",
              borderRadius: "78px",
              color: isCleanupButtonDisabled ? secondary : "#F9363C",
              cursor: isCleanupButtonDisabled ? "default" : "pointer",
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
            {cleanupButtonLabel}
          </button>
        </div>
      </div>
    );
  }

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
          background: rgba(249, 54, 60, 0.2) !important;
        }
        @media (max-width: 760px) {
          .earn-withdraw-header {
            display: none !important;
          }
        }
      `}</style>
      <div
        className="earn-withdraw-header"
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 20px 8px",
        }}
      >
        <h2
          style={{
            alignItems: "center",
            color: "#000",
            display: "inline-flex",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            gap: "8px",
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
                const sanitizedValue = sanitizeBucksAmountInput(
                  rawValue,
                  withdrawAmount
                );
                if (sanitizedValue === null) {
                  return;
                }
                const numericValue = Number(sanitizedValue.replace(/,/g, ""));
                setWithdrawAmount(
                  numericValue > selectedSourceMaxAmount
                    ? formatBucksAmount(selectedSourceMaxAmount)
                    : sanitizedValue
                );
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
            amount={selectedSourceMaxAmount.toLocaleString("en-US", {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            })}
            icon={selectedSource?.icon ?? TOP_EARN_VAULT.logo}
            isDropdown={sourceOptions.length > 1}
            isOpen={isSourceDropdownOpen}
            isPosition
            onClick={
              sourceOptions.length > 1
                ? () => setIsSourceDropdownOpen((open) => !open)
                : undefined
            }
            subtitle={selectedSource?.label ?? TOP_EARN_VAULT.label}
          />
          {alternateSourceOptions.length > 0 && isSourceDropdownOpen ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                padding: "4px 0 0",
              }}
            >
              {alternateSourceOptions.map((source) => (
                <WithdrawRouteRow
                  amount={source.balance.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                    minimumFractionDigits: 2,
                  })}
                  icon={source.icon}
                  isPosition
                  key={source.id}
                  onClick={() => {
                    setSelectedSourceId(source.id);
                    setIsSourceDropdownOpen(false);
                  }}
                  subtitle={source.label}
                />
              ))}
            </div>
          ) : null}
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
          className="earn-withdraw-submit"
          disabled={isWithdrawButtonDisabled}
          onClick={() =>
            onDraftSubmit
              ? void onDraftSubmit(buildCurrentDraft())
              : void onComplete?.({
                  amount: effectiveWithdrawAmount,
                  mode: effectiveWithdrawMode,
                })
          }
          style={{
            alignItems: "center",
            background: isWithdrawButtonDisabled
              ? "rgba(0, 0, 0, 0.04)"
              : "rgba(249, 54, 60, 0.14)",
            border: "none",
            borderRadius: "78px",
            color: isWithdrawButtonDisabled ? secondary : "#F9363C",
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
          overflow: "visible",
          padding: "0 12px",
          textAlign: "left",
          width: "100%",
        }}
        type="button"
      >
        <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
          <MainAccountUsdcIcon src={source.icon} />
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
  observedAtMs: number;
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

// Figma draws the chart vectors as Catmull-Rom splines (cubic Béziers whose
// control points sit at one-third of each segment), so straight polylines
// look jagged next to the design; this mirrors that smoothing while still
// passing through every data point.
function smoothChartLinePath(
  points: readonly { x: number; y: number }[]
): string {
  const first = points[0];
  if (!first) {
    return "";
  }
  const path = [`M${first.x.toFixed(2)},${first.y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (afterNext.x - current.x) / 6;
    const control2Y = next.y - (afterNext.y - current.y) / 6;
    path.push(
      `C${control1X.toFixed(2)},${control1Y.toFixed(2)} ${control2X.toFixed(
        2
      )},${control2Y.toFixed(2)} ${next.x.toFixed(2)},${next.y.toFixed(2)}`
    );
  }
  return path.join(" ");
}

// Real 30D history arrives at a much higher frequency than the design's
// ~5px-per-point vectors, so the raw polyline reads as high-frequency steps no
// matter how segments are joined. Averaging into at most this many buckets
// removes that noise and gives the spline room to render visibly smooth.
const HISTORICAL_APY_MAX_LINE_POINTS = 110;

function downsampleHistoricalApySamples(
  samples: HistoricalApySample[]
): HistoricalApySample[] {
  if (samples.length <= HISTORICAL_APY_MAX_LINE_POINTS) {
    return samples;
  }
  const buckets: HistoricalApySample[] = [];
  for (let index = 0; index < HISTORICAL_APY_MAX_LINE_POINTS; index += 1) {
    const start = Math.floor(
      (index * samples.length) / HISTORICAL_APY_MAX_LINE_POINTS
    );
    const end = Math.max(
      Math.floor(
        ((index + 1) * samples.length) / HISTORICAL_APY_MAX_LINE_POINTS
      ),
      start + 1
    );
    const bucket = samples.slice(start, end);
    // First/last buckets keep the exact range timestamps so the axis labels
    // and chart edges stay anchored to the true data window.
    const observedAtMs =
      index === 0
        ? bucket[0].observedAtMs
        : index === HISTORICAL_APY_MAX_LINE_POINTS - 1
        ? bucket[bucket.length - 1].observedAtMs
        : bucket[Math.floor(bucket.length / 2)].observedAtMs;
    buckets.push({
      apyPercent:
        bucket.reduce((sum, sample) => sum + sample.apyPercent, 0) /
        bucket.length,
      observedAtMs,
    });
  }
  return buckets;
}

// APY tab chart per Figma (4098:21423 default / 4098:21648 hover): the three
// lines render solid with dots at their endpoints; hovering veils the chart
// right of the cursor with 60% white, draws a dashed cursor line, moves the
// dots to the hovered time, and swaps the header stats to the hovered values.
const HISTORICAL_AXIS_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});
const HISTORICAL_HOVER_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});
const HISTORICAL_MAIN_USDC_FALLBACK_APY_PERCENT =
  (EARN_COMPARISON_SERIES.find((series) => series.key === "mainUsdcReserve")
    ?.fixedApyBps ?? 559) / 100;

function formatHistoricalApyValue(apyPercent: number, mutedFraction: boolean) {
  const [whole, fraction = "00"] = apyPercent.toFixed(2).split(".");
  return (
    <>
      {whole}
      <span
        style={{ color: mutedFraction ? "rgba(60, 60, 67, 0.4)" : "inherit" }}
      >
        .{fraction}%
      </span>
    </>
  );
}

function HistoricalApyChart({ rangeId }: { rangeId: EarningsRangeId }) {
  const apyHistory = useEarnForecastApyHistory();
  const samples = useMemo(() => {
    const fetchedSamples = toHistoricalApySamples(apyHistory);
    if (rangeId === "30D" && fetchedSamples.length > 0) {
      return downsampleHistoricalApySamples(fetchedSamples);
    }

    return downsampleHistoricalApySamples(
      buildHistoricalApySamples(rangeId, new Date())
    );
  }, [apyHistory, rangeId]);
  const mainUsdcSamples = useMemo(() => {
    if (rangeId !== "30D") {
      return [];
    }

    return downsampleHistoricalApySamples(
      toHistoricalBenchmarkSamples(apyHistory, "mainUsdcReserve")
    );
  }, [apyHistory, rangeId]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartBoxRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const node = chartBoxRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      setChartSize({
        height: entry.contentRect.height,
        width: entry.contentRect.width,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const isHovering = hoverIndex !== null;
  const focusSample =
    samples[Math.min(hoverIndex ?? samples.length - 1, samples.length - 1)];
  const mainUsdcApyPercentAt = (observedAtMs: number) =>
    nearestHistoricalApyPercent(
      mainUsdcSamples,
      observedAtMs,
      HISTORICAL_MAIN_USDC_FALLBACK_APY_PERCENT
    );
  const benchmarks: {
    apyPercentAt: (observedAtMs: number) => number;
    key: EarnComparisonSeriesKey;
    samples: HistoricalApySample[] | null;
  }[] = [
    {
      apyPercentAt: mainUsdcApyPercentAt,
      key: "mainUsdcReserve",
      samples: mainUsdcSamples.length > 0 ? mainUsdcSamples : null,
    },
    ...HISTORICAL_APY_STATIC_BENCHMARKS.map((series) => ({
      apyPercentAt: () => series.fixedApyBps / 100,
      key: series.key,
      samples: null,
    })),
  ];

  // Scale max rounds the highest line up to a round percent (labelled at the
  // chart's top right); the bottom pads ~20% of the spread below the lowest
  // line so the flattest benchmark keeps breathing room, as in the Figma spec.
  const scaleValues = [
    ...samples.map((sample) => sample.apyPercent),
    ...(mainUsdcSamples.length > 0
      ? mainUsdcSamples.map((sample) => sample.apyPercent)
      : [HISTORICAL_MAIN_USDC_FALLBACK_APY_PERCENT]),
    ...HISTORICAL_APY_STATIC_BENCHMARKS.map(
      (series) => series.fixedApyBps / 100
    ),
  ];
  const maxValue = Math.max(...scaleValues);
  const minValue = Math.min(...scaleValues);
  const valueRange = Math.max(maxValue - minValue, 0.01);
  const scaleQuantum = Math.max(
    10 ** Math.floor(Math.log10(valueRange)) / 2,
    0.01
  );
  const scaleMax = Math.ceil(maxValue / scaleQuantum) * scaleQuantum;
  const scaleMin = Math.max(
    Math.floor((minValue - valueRange * 0.2) / scaleQuantum) * scaleQuantum,
    0
  );

  const headerSeries = [
    {
      apyPercent: focusSample.apyPercent,
      color: EARN_SERIES_DISPLAY.loyal.color,
      key: "loyal" as EarnComparisonSeriesKey,
      label: EARN_SERIES_DISPLAY.loyal.label,
    },
    ...benchmarks.map((benchmark) => ({
      apyPercent: benchmark.apyPercentAt(focusSample.observedAtMs),
      color: EARN_SERIES_DISPLAY[benchmark.key].color,
      key: benchmark.key,
      label: EARN_SERIES_DISPLAY[benchmark.key].label,
    })),
  ];

  const chartWidth = chartSize.width;
  const chartHeight = chartSize.height;
  const hasChartArea = chartWidth > 2 && chartHeight > 2;
  const startedAtMs = samples[0]?.observedAtMs ?? 0;
  const endedAtMs = samples[samples.length - 1]?.observedAtMs ?? startedAtMs;
  // 1px inset on every side keeps the 2px round-cap strokes from clipping.
  const xForObservedAtMs = (observedAtMs: number) => {
    const progress =
      endedAtMs > startedAtMs
        ? Math.min(
            Math.max(
              (observedAtMs - startedAtMs) / (endedAtMs - startedAtMs),
              0
            ),
            1
          )
        : 1;
    return 1 + progress * (chartWidth - 2);
  };
  const yForValue = (value: number) => {
    const t = Math.min(
      Math.max((value - scaleMin) / Math.max(scaleMax - scaleMin, 0.01), 0),
      1
    );
    return 1 + (1 - t) * (chartHeight - 2);
  };
  const sampleLinePath = (lineSamples: readonly HistoricalApySample[]) =>
    smoothChartLinePath(
      lineSamples.map((sample) => ({
        x: xForObservedAtMs(sample.observedAtMs),
        y: yForValue(sample.apyPercent),
      }))
    );
  const flatLinePath = (value: number) => {
    const y = yForValue(value).toFixed(2);
    return `M1,${y} L${(chartWidth - 1).toFixed(2)},${y}`;
  };
  // Loyal renders last (on top), matching the Figma layer order.
  const plotLines = [
    ...benchmarks
      .map((benchmark) => ({
        color: EARN_SERIES_DISPLAY[benchmark.key].color,
        d: benchmark.samples
          ? sampleLinePath(benchmark.samples)
          : flatLinePath(benchmark.apyPercentAt(endedAtMs)),
        key: benchmark.key,
      }))
      .reverse(),
    {
      color: EARN_SERIES_DISPLAY.loyal.color,
      d: sampleLinePath(samples),
      key: "loyal" as EarnComparisonSeriesKey,
    },
  ];
  const focusX = xForObservedAtMs(focusSample.observedAtMs);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    setHoverIndex(Math.round((x / rect.width) * (samples.length - 1)));
  };

  return (
    <div
      style={{
        display: "flex",
        flex: "1 1 auto",
        flexDirection: "column",
        minHeight: 0,
        width: "100%",
      }}
    >
      <style jsx>{`
        .historical-chart-reveal-rect {
          animation: historical-chart-reveal 0.7s cubic-bezier(0.2, 0, 0, 1)
            both;
          transform-origin: 0 0;
        }
        .historical-chart-mode {
          transition: opacity 0.18s ease;
        }
        .historical-chart-dot {
          animation: historical-chart-fade-in 0.25s 0.5s ease both;
        }
        @keyframes historical-chart-reveal {
          0% {
            transform: scaleX(0);
          }
          100% {
            transform: scaleX(1);
          }
        }
        @keyframes historical-chart-fade-in {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .historical-chart-reveal-rect {
            animation: none;
          }
          .historical-chart-mode {
            transition: none;
          }
          .historical-chart-dot {
            animation: none;
          }
        }
      `}</style>

      <div
        style={{
          alignItems: "flex-end",
          display: "flex",
          gap: "20px",
          paddingBottom: "8px",
          width: "100%",
        }}
      >
        {headerSeries.map((series) => {
          const isPrimary = series.key === "loyal";
          return (
            <div
              key={series.key}
              style={{
                display: "flex",
                flex: "1 0 0",
                flexDirection: "column",
                gap: "2px",
                minWidth: 0,
              }}
            >
              <p
                style={{
                  color: isPrimary ? "#000" : "#3C3C43",
                  fontFamily: font,
                  fontSize: isPrimary ? "28px" : "20px",
                  fontWeight: 600,
                  lineHeight: isPrimary ? "32px" : "24px",
                  margin: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {formatHistoricalApyValue(series.apyPercent, !isPrimary)}
              </p>
              <span
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "4px",
                  height: "16px",
                  width: "100%",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    background: series.color,
                    borderRadius: "4px",
                    flexShrink: 0,
                    height: "12px",
                    width: "12px",
                  }}
                />
                <span
                  style={{
                    color: isPrimary ? "#000" : secondary,
                    fontFamily: font,
                    fontSize: "13px",
                    lineHeight: "16px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {series.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: font,
          fontSize: "13px",
          justifyContent: "space-between",
          lineHeight: "16px",
          paddingBottom: "8px",
          width: "100%",
        }}
      >
        <span style={{ color: secondary, whiteSpace: "nowrap" }}>
          {isHovering
            ? HISTORICAL_HOVER_DATE_FORMAT.format(focusSample.observedAtMs)
            : ""}
        </span>
        <span style={{ color: secondary, whiteSpace: "nowrap" }}>
          {`${scaleMax.toFixed(2)}%`}
        </span>
      </div>

      <div
        onPointerLeave={() => setHoverIndex(null)}
        onPointerMove={handlePointerMove}
        ref={chartBoxRef}
        style={{
          flex: "1 1 auto",
          minHeight: "300px",
          position: "relative",
          width: "100%",
        }}
      >
        {hasChartArea ? (
          <>
            <svg
              aria-label="Historical APY chart"
              height="100%"
              preserveAspectRatio="none"
              role="img"
              style={{ display: "block", overflow: "visible" }}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              width="100%"
            >
              <defs>
                <clipPath
                  clipPathUnits="userSpaceOnUse"
                  id="historical-chart-reveal-clip"
                >
                  <rect
                    className="historical-chart-reveal-rect"
                    height={chartHeight}
                    width={chartWidth}
                    x={0}
                    y={0}
                  />
                </clipPath>
              </defs>
              <g clipPath="url(#historical-chart-reveal-clip)">
                {plotLines.map((line) => (
                  <path
                    d={line.d}
                    fill="none"
                    key={line.key}
                    stroke={line.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                ))}
                <g
                  className="historical-chart-mode"
                  style={{ opacity: isHovering ? 1 : 0 }}
                >
                  <rect
                    fill="#fff"
                    fillOpacity={0.6}
                    height={chartHeight}
                    width={Math.max(chartWidth - focusX, 0)}
                    x={focusX}
                    y={0}
                  />
                  <line
                    stroke="#000"
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    strokeOpacity={0.14}
                    x1={focusX}
                    x2={focusX}
                    y1={0.5}
                    y2={chartHeight - 0.5}
                  />
                </g>
              </g>
            </svg>
            {headerSeries.map((series) => (
              <span
                aria-hidden="true"
                className="historical-chart-dot"
                key={`dot-${series.key}`}
                style={{
                  background: series.color,
                  borderRadius: "9999px",
                  boxShadow: "0 0 0 2px #fff",
                  height: "8px",
                  left: `${((focusX / chartWidth) * 100).toFixed(2)}%`,
                  pointerEvents: "none",
                  position: "absolute",
                  top: `${(
                    (yForValue(series.apyPercent) / chartHeight) *
                    100
                  ).toFixed(2)}%`,
                  transform: "translate(-50%, -50%)",
                  width: "8px",
                }}
              />
            ))}
          </>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: font,
          fontSize: "13px",
          justifyContent: "space-between",
          lineHeight: "16px",
          paddingTop: "8px",
          width: "100%",
        }}
      >
        <span style={{ color: secondary, whiteSpace: "nowrap" }}>
          {HISTORICAL_AXIS_DATE_FORMAT.format(startedAtMs)}
        </span>
        <span style={{ color: secondary, whiteSpace: "nowrap" }}>
          {HISTORICAL_AXIS_DATE_FORMAT.format(endedAtMs)}
        </span>
      </div>
    </div>
  );
}

// Forecast tab chart per Figma (4098:21881 default / 4098:22109 hover):
// resting state draws the Loyal line solid and benchmarks dashed with dots at
// the line endpoints; hovering turns every line solid, veils the future side
// with 60% white, and moves the dashed cursor line + dots to the hovered date.
function ForecastChart({
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
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartBoxRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const node = chartBoxRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      setChartSize({
        height: entry.contentRect.height,
        width: entry.contentRect.width,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const loyalApyBps = getEarnComparisonApyBps(apy.apyBps, null);
  const loyalTarget = principal * getEarnForecastTargetMultiplier(loyalApyBps);
  // Scale max is the Loyal endpoint rounded up to a round amount so the red
  // line nearly touches the top of the chart, as in the Figma spec.
  const scaleRange = Math.max(loyalTarget - principal, 0.01);
  const scaleQuantum = Math.max(
    10 ** (Math.floor(Math.log10(scaleRange)) - 1),
    0.01
  );
  const scaleMax = Math.max(
    Math.ceil(loyalTarget / scaleQuantum) * scaleQuantum,
    principal + scaleRange
  );

  const isHovering = hoverIndex !== null;
  const focusIndex = hoverIndex ?? points.length - 1;
  const focusPoint = points[focusIndex];

  const headerSeries = EARN_COMPARISON_SERIES.map((series) => ({
    apyBps: getEarnComparisonApyBps(
      apy.apyBps,
      series.key === "mainUsdcReserve"
        ? mainUsdcReserveApyBps
        : series.fixedApyBps
    ),
    color: EARN_SERIES_DISPLAY[series.key].color,
    key: series.key,
    label: EARN_SERIES_DISPLAY[series.key].label,
  }));
  // Loyal renders last (on top) in the plot, matching the Figma layer order.
  const lineSeries = [...EARN_COMPARISON_SERIES].reverse();

  const chartWidth = chartSize.width;
  const chartHeight = chartSize.height;
  const hasChartArea = chartWidth > 2 && chartHeight > 2;
  // 1px inset on every side keeps the 2px round-cap strokes from clipping.
  const xForIndex = (index: number) =>
    1 + (index / Math.max(points.length - 1, 1)) * (chartWidth - 2);
  const yForValue = (value: number) => {
    const t = Math.min(
      Math.max((value - principal) / (scaleMax - principal), 0),
      1
    );
    return 1 + (1 - t) * (chartHeight - 2);
  };
  const linePath = (key: EarnComparisonSeriesKey) =>
    smoothChartLinePath(
      points.map((point, index) => ({
        x: xForIndex(index),
        y: yForValue(point.values[key]),
      }))
    );
  const focusX = xForIndex(focusIndex);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    setHoverIndex(Math.round((x / rect.width) * (points.length - 1)));
  };

  return (
    <div
      style={{
        display: "flex",
        flex: "1 1 auto",
        flexDirection: "column",
        minHeight: 0,
        width: "100%",
      }}
    >
      <style jsx>{`
        .forecast-chart-reveal-rect {
          animation: forecast-chart-reveal 0.7s cubic-bezier(0.2, 0, 0, 1) both;
          transform-origin: 0 0;
        }
        .forecast-chart-mode {
          transition: opacity 0.18s ease;
        }
        .forecast-chart-dot {
          animation: forecast-chart-fade-in 0.25s 0.5s ease both;
        }
        @keyframes forecast-chart-reveal {
          0% {
            transform: scaleX(0);
          }
          100% {
            transform: scaleX(1);
          }
        }
        @keyframes forecast-chart-fade-in {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .forecast-chart-reveal-rect {
            animation: none;
          }
          .forecast-chart-mode {
            transition: none;
          }
          .forecast-chart-dot {
            animation: none;
          }
        }
        @media (max-width: 760px) {
          .forecast-chart-summary {
            display: grid !important;
            gap: 8px !important;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            padding-bottom: 6px !important;
          }

          .forecast-chart-summary-item {
            min-width: 0;
          }

          .forecast-chart-summary-value {
            font-size: 16px !important;
            line-height: 20px !important;
            min-width: 0;
            overflow: hidden;
          }

          .forecast-chart-summary-value[data-primary="true"] {
            font-size: 24px !important;
            line-height: 28px !important;
          }

          .forecast-chart-summary-label {
            font-size: 12px !important;
            min-width: 0;
          }
        }
      `}</style>

      <div
        className="forecast-chart-summary"
        style={{
          alignItems: "flex-end",
          display: "flex",
          gap: "20px",
          paddingBottom: "8px",
          width: "100%",
        }}
      >
        {headerSeries.map((series) => {
          const isPrimary = series.key === "loyal";
          return (
            <div
              className="forecast-chart-summary-item"
              key={series.key}
              style={{
                display: "flex",
                flex: "1 0 0",
                flexDirection: "column",
                gap: "2px",
                minWidth: 0,
              }}
            >
              <p
                className="forecast-chart-summary-value"
                data-primary={isPrimary ? "true" : undefined}
                style={{
                  color: isBalanceHidden
                    ? "#BBBBC0"
                    : isPrimary
                    ? "#000"
                    : "#3C3C43",
                  filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
                  fontFamily: font,
                  fontSize: isPrimary ? "28px" : "16px",
                  fontWeight: 600,
                  lineHeight: isPrimary ? "32px" : "20px",
                  margin: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {formatForecastMoney(
                  focusPoint.values[series.key],
                  !isBalanceHidden
                )}
              </p>
              <span
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "4px",
                  height: "16px",
                  width: "100%",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    background: series.color,
                    borderRadius: "4px",
                    flexShrink: 0,
                    height: "12px",
                    width: "12px",
                  }}
                />
                <span
                  className="forecast-chart-summary-label"
                  style={{
                    color: isPrimary ? "#000" : secondary,
                    fontFamily: font,
                    fontSize: "13px",
                    lineHeight: "16px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {`${series.label} (${formatEarnApyPercent(
                    series.apyBps
                  )} APY)`}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: font,
          fontSize: "13px",
          justifyContent: "space-between",
          lineHeight: "16px",
          paddingBottom: "8px",
          width: "100%",
        }}
      >
        <span style={{ color: secondary, whiteSpace: "nowrap" }}>
          {isHovering ? focusPoint.date : ""}
        </span>
        <span
          style={{
            color: secondary,
            filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
            whiteSpace: "nowrap",
          }}
        >
          {`$${formatMoney(scaleMax)}`}
        </span>
      </div>

      <div
        onPointerLeave={() => setHoverIndex(null)}
        onPointerMove={handlePointerMove}
        ref={chartBoxRef}
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          position: "relative",
          width: "100%",
        }}
      >
        {hasChartArea ? (
          <>
            <svg
              aria-label="Projected earnings comparison chart"
              height="100%"
              preserveAspectRatio="none"
              role="img"
              style={{ display: "block", overflow: "visible" }}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              width="100%"
            >
              <defs>
                <clipPath
                  clipPathUnits="userSpaceOnUse"
                  id="forecast-tab-reveal-clip"
                >
                  <rect
                    className="forecast-chart-reveal-rect"
                    height={chartHeight}
                    width={chartWidth}
                    x={0}
                    y={0}
                  />
                </clipPath>
              </defs>
              <g clipPath="url(#forecast-tab-reveal-clip)">
                <g
                  className="forecast-chart-mode"
                  style={{ opacity: isHovering ? 0 : 1 }}
                >
                  {lineSeries.map((series) => (
                    <path
                      d={linePath(series.key)}
                      fill="none"
                      key={`resting-${series.key}`}
                      stroke={EARN_SERIES_DISPLAY[series.key].color}
                      strokeDasharray={
                        series.key === "loyal" ? undefined : "4 4"
                      }
                      strokeLinecap="round"
                      strokeWidth={2}
                    />
                  ))}
                </g>
                <g
                  className="forecast-chart-mode"
                  style={{ opacity: isHovering ? 1 : 0 }}
                >
                  {lineSeries.map((series) => (
                    <path
                      d={linePath(series.key)}
                      fill="none"
                      key={`focused-${series.key}`}
                      stroke={EARN_SERIES_DISPLAY[series.key].color}
                      strokeLinecap="round"
                      strokeWidth={2}
                    />
                  ))}
                  <rect
                    fill="#fff"
                    fillOpacity={0.6}
                    height={chartHeight}
                    width={Math.max(chartWidth - focusX, 0)}
                    x={focusX}
                    y={0}
                  />
                  <line
                    stroke="#000"
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    strokeOpacity={0.14}
                    x1={focusX}
                    x2={focusX}
                    y1={0.5}
                    y2={chartHeight - 0.5}
                  />
                </g>
              </g>
            </svg>
            {lineSeries.map((series) => (
              <span
                aria-hidden="true"
                className="forecast-chart-dot"
                key={`dot-${series.key}`}
                style={{
                  background: EARN_SERIES_DISPLAY[series.key].color,
                  borderRadius: "9999px",
                  boxShadow: "0 0 0 2px #fff",
                  height: "8px",
                  left: `${((focusX / chartWidth) * 100).toFixed(2)}%`,
                  pointerEvents: "none",
                  position: "absolute",
                  top: `${(
                    (yForValue(focusPoint.values[series.key]) / chartHeight) *
                    100
                  ).toFixed(2)}%`,
                  transform: "translate(-50%, -50%)",
                  width: "8px",
                }}
              />
            ))}
          </>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: font,
          fontSize: "13px",
          justifyContent: "space-between",
          lineHeight: "16px",
          paddingTop: "8px",
          width: "100%",
        }}
      >
        <span
          style={{
            color: secondary,
            filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
            whiteSpace: "nowrap",
          }}
        >
          {`Today · $${formatMoney(principal)}`}
        </span>
        <span style={{ color: secondary, whiteSpace: "nowrap" }}>
          {points[points.length - 1]?.date ?? ""}
        </span>
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

type EarnDepositChartTab = "Forecast" | "Historical";

const EARN_DEPOSIT_CHART_TABS: readonly {
  id: EarnDepositChartTab;
  label: string;
}[] = [
  { id: "Forecast", label: "Forecast" },
  { id: "Historical", label: "APY" },
];

function EarnDepositChartsSection({
  apy,
  defaultActiveTab = "Forecast",
  forecastAmount,
  forecastAmountLabel,
  mainUsdcReserveApyBps,
}: {
  apy: EarnForecastApy;
  defaultActiveTab?: EarnDepositChartTab;
  forecastAmount: number;
  forecastAmountLabel: string;
  mainUsdcReserveApyBps: number;
}) {
  const [activeTab, setActiveTab] =
    useState<EarnDepositChartTab>(defaultActiveTab);
  const [forecastRevision, setForecastRevision] = useState(0);
  const [historicalRevision, setHistoricalRevision] = useState(0);
  useEffect(() => {
    setActiveTab(defaultActiveTab);
  }, [defaultActiveTab]);
  const handleTabChange = (next: EarnDepositChartTab) => {
    if (next === activeTab) return;
    setActiveTab(next);
    if (next === "Forecast") {
      setForecastRevision((revision) => revision + 1);
    } else {
      setHistoricalRevision((revision) => revision + 1);
    }
  };

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
        .earn-deposit-chart-panel {
          transition: opacity 0.34s cubic-bezier(0.2, 0, 0, 1),
            transform 0.34s cubic-bezier(0.2, 0, 0, 1),
            filter 0.34s cubic-bezier(0.2, 0, 0, 1);
        }
        @media (max-width: 760px) {
          .earn-deposit-chart-header {
            gap: 6px !important;
            padding: 0 4px 8px !important;
          }

          .earn-deposit-chart-tabs {
            flex: 0 0 auto !important;
            gap: 4px !important;
          }

          .earn-forecast-chips {
            flex: 1 1 auto !important;
            justify-content: flex-end;
            min-width: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .earn-deposit-chart-panel {
            transition: none;
          }
        }
      `}</style>
      <div
        className="earn-deposit-chart-header"
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
          className="earn-deposit-chart-tabs"
          style={{
            display: "flex",
            flex: 1,
            gap: "8px",
            minWidth: 0,
          }}
        >
          {EARN_DEPOSIT_CHART_TABS.map((tab) => {
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
        {activeTab === "Forecast" ? (
          <div
            className="earn-forecast-chips"
            style={{
              display: "flex",
              flexShrink: 0,
              gap: "4px",
            }}
          >
            <span
              style={{
                background: "#000",
                borderRadius: "9999px",
                color: "#fff",
                display: "inline-flex",
                fontFamily: font,
                fontSize: "13px",
                fontWeight: 500,
                lineHeight: "16px",
                maxWidth: "160px",
                overflow: "hidden",
                padding: "4px 10px",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {forecastAmountLabel}
            </span>
          </div>
        ) : null}
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
          className="earn-deposit-chart-panel"
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
              mainUsdcReserveApyBps={mainUsdcReserveApyBps}
              principal={forecastAmount}
            />
          </div>
        </div>
        <div
          aria-hidden={activeTab !== "Historical"}
          className="earn-deposit-chart-panel"
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: "430px",
              padding: "4px 12px 0",
              width: "100%",
            }}
          >
            <HistoricalApyChart rangeId="30D" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function EarnDepositView({
  existingPrincipalAmount = 0,
  isSubmitting = false,
  onClose,
  onDraftChange,
  onDraftSubmit,
  defaultChartTab = "Forecast",
  showFundingControls = true,
  showCloseButton = true,
  sources = FALLBACK_EARN_DEPOSIT_SOURCES,
  submitCtaLabel = null,
  submitError = null,
}: {
  existingPrincipalAmount?: number;
  isSubmitting?: boolean;
  onClose?: () => void;
  defaultChartTab?: EarnDepositChartTab;
  onDraftChange?: (draft: EarnDepositDraft | null) => void;
  onDraftSubmit?: (draft: EarnDepositDraft) => void | Promise<void>;
  showFundingControls?: boolean;
  showCloseButton?: boolean;
  sources?: EarnDepositSourceOption[];
  submitCtaLabel?: string | null;
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
  const numericDepositAmount =
    Number.parseFloat(depositAmount.replace(/,/g, "")) || 0;
  const hasDepositAmount = depositAmount.length > 0;
  const isMaximumDepositMode = depositAmount.length === 0;
  const effectiveDepositAmount = isMaximumDepositMode
    ? selectedSourceBalance
    : numericDepositAmount;
  const effectiveDepositAmountLabel = isMaximumDepositMode
    ? formatDepositAmount(selectedSourceBalance)
    : depositAmount;
  const forecastBaseAmount =
    Number.isFinite(existingPrincipalAmount) && existingPrincipalAmount > 0
      ? existingPrincipalAmount
      : 0;
  const forecastAmount = forecastBaseAmount + effectiveDepositAmount;
  const forecastAmountLabel = `$${formatEarnActionCtaAmount(forecastAmount)}`;
  const amountError =
    effectiveDepositAmount < MIN_DEPOSIT_USDC
      ? `Minimum deposit is ${MIN_DEPOSIT_USDC} USDC`
      : hasDepositAmount && numericDepositAmount > selectedSourceBalance
      ? "Insufficient balance"
      : null;
  const isConnectCta = Boolean(submitCtaLabel);
  const isDepositButtonDisabled =
    isSubmitting || (!isConnectCta && amountError !== null);
  const depositButtonLabel = isSubmitting
    ? "Depositing..."
    : submitCtaLabel ??
      amountError ??
      `Deposit $${formatEarnActionCtaAmount(effectiveDepositAmount)}`;
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
    if (!sourceOptions.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(
        sourceOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
      );
    }
  }, [selectedSourceId, sourceOptions]);

  useEffect(() => {
    if (!shouldAutoFocusEarnFormInput()) {
      return;
    }

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
          background: ${isConnectCta ? "#e72f34" : "#222"} !important;
        }
        @media (max-width: 760px) {
          .earn-deposit-header {
            display: none !important;
          }
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
        className="earn-deposit-header"
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
        {showCloseButton ? <CloseButton onClick={onClose} /> : null}
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

        {showFundingControls ? (
          <>
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
                      const sanitizedValue = sanitizeBucksAmountInput(
                        rawValue,
                        depositAmount
                      );
                      if (sanitizedValue !== null) {
                        depositAmountTouchedRef.current = true;
                        setDepositAmount(sanitizedValue);
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
                style={{
                  display: "flex",
                  flexDirection: "column",
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
                <DepositSourceRow isStatic source={selectedSource} />
              </div>
            </section>
          </>
        ) : null}

        <EarnDepositChartsSection
          apy={earnForecastApy}
          defaultActiveTab={defaultChartTab}
          forecastAmount={forecastAmount}
          forecastAmountLabel={forecastAmountLabel}
          mainUsdcReserveApyBps={mainUsdcReserveApyBps}
        />
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
            background:
              amountError && !isConnectCta
                ? "rgba(249, 54, 60, 0.14)"
                : isDepositButtonDisabled
                ? "rgba(0, 0, 0, 0.04)"
                : isConnectCta
                ? "#F9363C"
                : "#000",
            border: "none",
            borderRadius: "78px",
            color:
              amountError && !isConnectCta
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

// Large borderless amount input shared by the deposit goal and the minimum
// balance fields. Clicking anywhere in the row focuses and selects the input.
function AutodepositAmountInputRow({
  inputRef,
  onValueChange,
  value,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const focusInput = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  return (
    <div
      onClick={focusInput}
      style={{
        alignItems: "baseline",
        cursor: "text",
        display: "flex",
        padding: "8px 0",
      }}
    >
      <BucksAmountInput
        inputRef={inputRef}
        onValueChange={(rawValue) => {
          const sanitizedValue = sanitizeBucksAmountInput(rawValue, value);
          if (sanitizedValue !== null) {
            onValueChange(sanitizedValue);
          }
        }}
        value={value}
      />
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
        overflow: "visible",
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

// Autodeposit setup / edit pane. The signed allowance is fixed elsewhere for
// now; this pane only edits the Main Account balance floor.
export function AutodepositSetupView({
  earnBalance = 0,
  earnVaultAddressLabel,
  initialKeepAmount = "500",
  isEditing = false,
  isPendingSetup = false,
  mainSource,
  onBack,
  onDelete,
  onSubmit,
}: {
  earnBalance?: number;
  earnVaultAddressLabel?: string | null;
  initialKeepAmount?: string;
  isEditing?: boolean;
  isPendingSetup?: boolean;
  mainSource?: EarnDepositSourceOption | null;
  onBack?: () => void;
  onDelete?: () => void;
  onSubmit?: (keepAmount: string) => void;
}) {
  const keepAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [keepAmount, setKeepAmount] = useState(initialKeepAmount);
  const earnBalanceLabel = formatMoney(earnBalance);
  const [earnWhole, earnFraction = "00"] = earnBalanceLabel.split(".");
  const normalizeAutodepositAmount = (value: string) =>
    Number(value.replace(/,/g, "")) || 0;
  const keepAmountChanged =
    normalizeAutodepositAmount(keepAmount) !==
    normalizeAutodepositAmount(initialKeepAmount);
  const hasChanges = !isEditing || keepAmountChanged;
  const canSubmit = hasChanges;
  const submitLabel = isEditing
    ? !hasChanges
      ? "No changes yet"
      : "Update minimum balance"
    : isPendingSetup
    ? "Finish setup"
    : "Create Autodeposit";
  const mainAccountHelpLabel = mainSource?.addressLabel ?? "your Main Account";
  const helpTooltip = (topic: EarnHelpTopic) =>
    getEarnHelpTooltip(topic, {
      autodepositFloorLabel: `$${formatMoney(
        normalizeAutodepositAmount(keepAmount)
      )}`,
      hasEarnPosition: earnBalance > 0,
      mainAccountLabel: mainAccountHelpLabel,
    });

  const focusKeepAmount = () => {
    keepAmountInputRef.current?.focus();
    keepAmountInputRef.current?.select();
  };

  useEffect(() => {
    if (!shouldAutoFocusEarnFormInput()) {
      return;
    }

    const frame = window.requestAnimationFrame(focusKeepAmount);
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
        @media (max-width: 760px) {
          .autodeposit-header {
            display: none !important;
          }

          .autodeposit-primary-section {
            padding-top: 12px !important;
          }
        }
      `}</style>

      <div
        className="autodeposit-header"
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
            alignItems: "center",
            color: "#000",
            display: "flex",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            gap: "8px",
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Autodeposit
          </span>
          <EarnSectionHelpTrigger
            ariaLabel="About Autodeposit"
            tooltip={helpTooltip("autodeposit")}
          />
        </h2>
        {isEditing && !isPendingSetup && onDelete ? (
          <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
            <EarnSectionHelpTrigger
              ariaLabel="About deleting Autodeposit"
              tooltip={helpTooltip("autodepositDelete")}
            />
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
          </div>
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
          className="autodeposit-primary-section"
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "22px 8px 8px",
            width: "100%",
          }}
        >
          <div style={{ padding: "3px 12px 1px" }}>
            <div
              style={{
                alignItems: "center",
                color: secondary,
                display: "inline-flex",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                gap: "8px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              <span>Only deposit anything above this amount</span>
              <EarnSectionHelpTrigger
                ariaLabel="About the Autodeposit minimum"
                tooltip={helpTooltip("autodepositThreshold")}
              />
            </div>
            <AutodepositAmountInputRow
              inputRef={keepAmountInputRef}
              onValueChange={setKeepAmount}
              value={keepAmount}
            />
          </div>
          <div style={{ padding: "0 12px" }}>
            <AutodepositAmountChips
              onSelect={setKeepAmount}
              selectedValue={keepAmount}
            />
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
            <div
              style={{
                alignItems: "center",
                color: secondary,
                display: "inline-flex",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                gap: "8px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              <span>From</span>
              <EarnSectionHelpTrigger
                ariaLabel="About the Autodeposit source"
                tooltip={helpTooltip("autodepositSource")}
              />
            </div>
          </div>
          <AutodepositSummaryRow
            fraction={mainSource?.balanceFraction ?? "00"}
            icon={
              mainSource?.icon ? (
                <MainAccountUsdcIcon src={mainSource.icon} />
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
          <div style={{ padding: "3px 12px 1px" }}>
            <div
              style={{
                alignItems: "center",
                color: secondary,
                display: "inline-flex",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                gap: "8px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              <span>To</span>
              <EarnSectionHelpTrigger
                ariaLabel="About the Autodeposit destination"
                tooltip={helpTooltip("autodepositDestination")}
              />
            </div>
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
          // A stranded trailing dot ("8.") is valid mid-typing but not a
          // valid amount label downstream, so it is dropped on submit.
          onClick={() => onSubmit?.(keepAmount.replace(/\.$/, ""))}
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
