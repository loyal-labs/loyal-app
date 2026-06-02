import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildEarnChartPoints,
  clampDepositAmountInput,
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
