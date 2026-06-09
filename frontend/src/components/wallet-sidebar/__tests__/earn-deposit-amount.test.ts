import { describe, expect, test } from "bun:test";

import type { EarnEarningsResponse } from "@/lib/yield-optimization/earnings.shared";

import {
  buildEarnComparisonPoints,
  buildEarnChartPoints,
  buildForecastAmountOptions,
  clampDepositAmountInput,
  deriveMainUsdcReserveForecastApyBps,
  deriveEstimatedEarnBalanceAmount,
  deriveEstimatedEarnedAmount,
  deriveEstimatedEarnedAmountApyBps,
  deriveEarnWithdrawMode,
  formatEarnActionAmount,
  formatEarnActionCtaAmount,
  formatHistoricalApyDelta,
  formatHistoricalAxisDate,
  formatMonthlyEarningsBarLabel,
  getDefaultForecastSelection,
  getForecastAmountForSelection,
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

  test("formats button amounts like the deposit CTA", () => {
    expect(formatEarnActionCtaAmount(1280)).toBe("1,280");
    expect(formatEarnActionCtaAmount(12.340001)).toBe("12.35");
    expect(formatEarnActionCtaAmount(5.008)).toBe("5.01");
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

});

describe("Earn forecast amount options", () => {
  test("shows the current input amount before fixed presets when the user has USDC", () => {
    const options = buildForecastAmountOptions(20, 5);

    expect(options.map((option) => option.label)).toEqual([
      "$5",
      "$100",
      "$500",
      "$1,000",
      "$5,000",
    ]);
    expect(options[0]).toMatchObject({
      selection: "you",
      value: 5,
    });
  });

  test("falls back to the user's max balance when the input is empty", () => {
    const options = buildForecastAmountOptions(20, null);
    const selection = getDefaultForecastSelection(20);

    expect(options[0]).toMatchObject({
      label: "$20",
      selection: "you",
      value: 20,
    });
    expect(selection).toBe("you");
    expect(getForecastAmountForSelection(selection, 20, null)).toBe(20);
    expect(getForecastAmountForSelection(selection, 20, 5)).toBe(5);
  });

  test("uses zero when the user explicitly enters zero", () => {
    const options = buildForecastAmountOptions(20, 0);
    const selection = getDefaultForecastSelection(20);

    expect(options[0]).toMatchObject({
      label: "$0",
      selection: "you",
      value: 0,
    });
    expect(getForecastAmountForSelection(selection, 20, 0)).toBe(0);
  });

  test("keeps the existing default preset with no USDC balance", () => {
    const options = buildForecastAmountOptions(0, null);
    const selection = getDefaultForecastSelection(0);

    expect(options.map((option) => option.label)).toEqual([
      "$100",
      "$500",
      "$1,000",
      "$5,000",
    ]);
    expect(selection).toBe(1000);
    expect(getForecastAmountForSelection(selection, 0, null)).toBe(1000);
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

});

describe("Earn earnings series UI", () => {
  test("formats monthly bar labels by month and year", () => {
    expect(formatMonthlyEarningsBarLabel("2026-11-01T00:00:00.000Z")).toBe(
      "Nov 2026"
    );
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
