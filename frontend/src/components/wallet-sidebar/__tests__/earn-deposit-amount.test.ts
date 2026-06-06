import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EarnEarningsResponse } from "@/lib/yield-optimization/earnings.shared";

import {
  buildEarnComparisonPoints,
  buildEarnChartPoints,
  clampDepositAmountInput,
  deriveMainUsdcReserveForecastApyBps,
  deriveEstimatedEarnBalanceAmount,
  deriveEstimatedEarnedAmount,
  deriveEstimatedEarnedAmountApyBps,
  deriveEarnWithdrawMode,
  formatEarnActionAmount,
  formatHistoricalApyDelta,
  formatHistoricalAxisDate,
  formatMonthlyEarningsBarLabel,
  getEarningsRatePerSecond,
} from "../earn-detail-view";

describe("clampDepositAmountInput", () => {
  test("caps typed values at the available balance", () => {
    expect(clampDepositAmountInput("2000", 1280)).toBe("1,280");
  });

  test("caps pasted decimal values at the available balance", () => {
    expect(clampDepositAmountInput("20.000001", 20)).toBe("20");
  });

  test("keeps valid in-balance input unchanged", () => {
    expect(clampDepositAmountInput("12.34", 20)).toBe("12.34");
  });

  test("rejects non-numeric input", () => {
    expect(clampDepositAmountInput("12a", 20)).toBeNull();
  });
});

describe("Earn action amount formatting", () => {
  test("formats all-mode amounts with two upward-rounded decimals", () => {
    expect(formatEarnActionAmount(1280)).toBe("1,280.00");
    expect(formatEarnActionAmount(12.340001)).toBe("12.35");
  });
});

describe("earn forecast APY", () => {
  test("chart uses API APY values for target, low, and high paths", () => {
    const points = buildEarnChartPoints(1000, {
      apyBps: 910,
      rangeHighBps: 940,
      rangeLowBps: 870,
    });
    const finalPoint = points.at(-1);

    expect(finalPoint?.value).toBeCloseTo(1091, 6);
    expect(finalPoint?.lowValue).toBeCloseTo(1087, 6);
    expect(finalPoint?.highValue).toBeCloseTo(1094, 6);
  });

  test("comparison chart uses Main USDC APY from forecast history", () => {
    const points = buildEarnComparisonPoints(
      1000,
      {
        apyBps: 910,
        rangeHighBps: 940,
        rangeLowBps: 870,
      },
      { mainUsdcReserve: 543 }
    );
    const finalPoint = points.at(-1);

    expect(finalPoint?.values.loyal).toBeCloseTo(1091, 6);
    expect(finalPoint?.values.mainUsdcReserve).toBeCloseTo(1054.3, 6);
  });

  test("derives Main USDC forecast APY from the latest corrected sample", () => {
    expect(
      deriveMainUsdcReserveForecastApyBps({
        series: [
          {
            key: "loyal",
            label: "Loyal Earn",
            samples: [{ apyBps: 910, observedAt: "2026-05-31T00:00:00.000Z" }],
          },
          {
            key: "mainUsdcReserve",
            label: "Kamino Main USDC",
            metadata: {
              metric: "cumulative_annualized_apy_bps",
            },
            samples: [
              { apyBps: 523, observedAt: "2026-05-15T00:00:00.000Z" },
              { apyBps: 543, observedAt: "2026-05-31T00:00:00.000Z" },
            ],
          },
        ],
      })
    ).toBe(543);
  });

  test("Earn UI copy does not hardcode the fallback APY", () => {
    const earnDetail = readFileSync(
      resolve(import.meta.dir, "../earn-detail-view.tsx"),
      "utf8"
    );
    const portfolio = readFileSync(
      resolve(import.meta.dir, "../portfolio-content.tsx"),
      "utf8"
    );

    expect(`${earnDetail}\n${portfolio}`).not.toContain("8.46% APY");
    expect(`${earnDetail}\n${portfolio}`).not.toContain("1197");
    expect(`${earnDetail}\n${portfolio}`).not.toContain("11.97% APY");
    expect(earnDetail).toContain("FALLBACK_EARN_FORECAST");
  });
});

describe("historical APY chart", () => {
  test("formats chart dates as month and day labels", () => {
    expect(formatHistoricalAxisDate(new Date("2026-05-01T12:00:00.000Z"))).toBe(
      "May 01"
    );
  });

  test("compares hovered APY against Main Market USDC", () => {
    expect(formatHistoricalApyDelta(1.234)).toBe(
      "+1.23% vs Main Market USDC"
    );
    expect(formatHistoricalApyDelta(-0.456)).toBe(
      "-0.46% vs Main Market USDC"
    );
  });

  test("shows Main USDC and T-Bill APY benchmarks on the APY graph", () => {
    const earnDetail = readFileSync(
      resolve(import.meta.dir, "../earn-detail-view.tsx"),
      "utf8"
    );

    expect(earnDetail).toContain("mainUsdcReserve");
    expect(earnDetail).toContain('label: "Main Market USDC"');
    expect(earnDetail).toContain('fixedApyBps: 365');
    expect(earnDetail).toContain("nearestHistoricalApyPercent");
    expect(earnDetail).toContain("benchmarkLines.map");
  });

  test("consumes fetched Medium 1bps APY samples when present", () => {
    const earnDetail = readFileSync(
      resolve(import.meta.dir, "../earn-detail-view.tsx"),
      "utf8"
    );

    expect(earnDetail).toContain("useEarnForecastApyHistory");
    expect(earnDetail).toContain("toHistoricalApySamples");
    expect(earnDetail).toContain('rangeId === "30D"');
  });
});

describe("Earn earnings series UI", () => {
  test("uses the real earnings endpoint instead of the old fake range model", () => {
    const earnDetail = readFileSync(
      resolve(import.meta.dir, "../earn-detail-view.tsx"),
      "utf8"
    );
    const useEarnEarnings = readFileSync(
      resolve(import.meta.dir, "../../../hooks/use-earn-earnings.ts"),
      "utf8"
    );

    expect(earnDetail).toContain("useEarnEarnings");
    expect(earnDetail).not.toContain("getBrowserTimezone");
    expect(earnDetail).not.toContain("timezone:");
    expect(earnDetail).toContain("earnings-bar-current");
    expect(earnDetail).toContain("earnings-bar-fill");
    expect(earnDetail).toContain("height: 100%");
    expect(useEarnEarnings).toContain(
      "/api/smart-accounts/yield-optimization/earnings"
    );
    expect(useEarnEarnings).toContain("Earnings are unavailable.");
    expect(earnDetail).toContain("getEarningsFractionDigits");
    expect(earnDetail).toContain("EARN_BALANCE_DECIMALS");
    expect(earnDetail).not.toContain("EARNINGS_DEPOSIT_OFFSET_MS");
    expect(earnDetail).not.toContain('id: "1M"');
    expect(earnDetail).not.toContain('id: "6M"');
    expect(earnDetail).not.toContain("earnings-range-chip");
    expect(earnDetail).toContain('const EARNINGS_MONTHLY_RANGE_ID = "1Y"');
    expect(earnDetail).toContain("earnings-bars-monthly");
    expect(earnDetail).toContain("earnings-bar-zero");
    expect(earnDetail).toContain("earnings-bar-current-positive");
    expect(earnDetail).toContain("visualHeightPct");
    expect(earnDetail).toContain("earningsAxisLabels");
    expect(earnDetail).not.toContain("Today");
    expect(formatMonthlyEarningsBarLabel("2026-11-01T00:00:00.000Z")).toBe(
      "Nov 2026"
    );
  });

  test("shares earnings data with the header balance amount", () => {
    const earnDetail = readFileSync(
      resolve(import.meta.dir, "../earn-detail-view.tsx"),
      "utf8"
    );

    expect(earnDetail).toContain(
      "const displayBalanceAmount = deriveEstimatedEarnBalanceAmount"
    );
    expect(earnDetail).toContain("baseAmount={displayBalanceAmount}");
    expect(earnDetail).toContain("apyBps={estimatedEarnedAmountApyBps}");
    expect(earnDetail).toContain("principalAmount={principalAmount}");
    expect(earnDetail).toContain("Balance ·");
    expect(earnDetail).not.toContain("apyBps={earnForecastApy.apyBps}");
  });
});

describe("estimated Earned amount", () => {
  const earningsData = {
    bars: [],
    currentApyBps: 512,
    lifetimeEarnedUsd: 2.75,
    principalAmountRaw: "100000000",
    principalUsd: 100,
    rangeEarnedUsd: 0.4,
    todayEarnedUsd: 0.01,
  } satisfies EarnEarningsResponse;

  test("starts from zero before earnings load", () => {
    expect(
      deriveEstimatedEarnedAmount({
        earningsData: null,
        earningsError: null,
      })
    ).toBe(0);
  });

  test("uses lifetime estimated earnings after earnings load", () => {
    expect(
      deriveEstimatedEarnedAmount({
        earningsData,
        earningsError: null,
      })
    ).toBe(2.75);
  });

  test("uses principal plus lifetime earnings for the header balance", () => {
    expect(
      deriveEstimatedEarnBalanceAmount({
        apyBps: earningsData.currentApyBps ?? 0,
        earningsData,
        earningsError: null,
        generatedAt: null,
        principalAmount: 100,
      })
    ).toBe(102.75);
  });

  test("falls back to zero on earnings error", () => {
    expect(
      deriveEstimatedEarnedAmount({
        earningsData,
        earningsError: "Earnings are unavailable.",
      })
    ).toBe(0);
  });

  test("uses current earnings APY and principal for live ticking", () => {
    const earnedAmount = deriveEstimatedEarnedAmount({
      earningsData,
      earningsError: null,
    });
    const apyBps = deriveEstimatedEarnedAmountApyBps({
      earningsData,
      earningsError: null,
      fallbackApyBps: 1197,
    });

    expect(earnedAmount).toBe(2.75);
    expect(apyBps).toBe(earningsData.currentApyBps);
    expect(
      getEarningsRatePerSecond(apyBps, earningsData.principalUsd)
    ).toBeCloseTo((100 * 0.0512) / (365 * 24 * 60 * 60), 15);
  });

  test("uses the forecast APY while earnings are still loading", () => {
    expect(
      deriveEstimatedEarnedAmountApyBps({
        earningsData: null,
        earningsError: null,
        fallbackApyBps: 1197,
      })
    ).toBe(1197);
  });
});

describe("Earn withdrawal mode", () => {
  test("derives partial mode below the confirmed active principal", () => {
    expect(
      deriveEarnWithdrawMode({
        amount: 24.5,
        maxWithdrawAmount: 25,
      })
    ).toBe("partial");
  });

  test("derives full mode at the confirmed active principal", () => {
    expect(
      deriveEarnWithdrawMode({
        amount: 25,
        maxWithdrawAmount: 25,
      })
    ).toBe("full");
  });
});
