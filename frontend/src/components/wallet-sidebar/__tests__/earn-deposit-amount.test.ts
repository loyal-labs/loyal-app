import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EarnEarningsResponse } from "@/lib/yield-optimization/earnings.shared";

import {
  buildEarnChartPoints,
  clampDepositAmountInput,
  deriveEstimatedEarnBalanceAmount,
  deriveEstimatedEarnedAmount,
  deriveEstimatedEarnedAmountApyBps,
  deriveEarnWithdrawMode,
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

describe("earn forecast APY", () => {
  test("chart uses API APY values for target, low, and high paths", () => {
    const points = buildEarnChartPoints(1000, {
      apyBps: 1197,
      rangeHighBps: 1325,
      rangeLowBps: 856,
    });
    const finalPoint = points.at(-1);

    expect(finalPoint?.value).toBeCloseTo(1119.7, 6);
    expect(finalPoint?.lowValue).toBeCloseTo(1085.6, 6);
    expect(finalPoint?.highValue).toBeCloseTo(1132.5, 6);
  });

  test("fallback 11.97% APY replaces the old Earn UI copy", () => {
    const earnDetail = readFileSync(
      resolve(import.meta.dir, "../earn-detail-view.tsx"),
      "utf8"
    );
    const portfolio = readFileSync(
      resolve(import.meta.dir, "../portfolio-content.tsx"),
      "utf8"
    );

    expect(`${earnDetail}\n${portfolio}`).not.toContain("8.46% APY");
    expect(earnDetail).toContain("FALLBACK_EARN_FORECAST");
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
