import { describe, expect, test } from "bun:test";

import {
  formatTokenAmount,
  getEffectiveSpendingLimitRemainingAmount,
  getSpendingLimitNextReset,
  getSpendingLimitPeriodSeconds,
} from "../spending-limits";

describe("spending limit helpers", () => {
  test("virtually resets recurring limits after the period passes", () => {
    expect(
      getEffectiveSpendingLimitRemainingAmount({
        amount: 1_000n,
        lastReset: 1_000,
        now: 1_000 + getSpendingLimitPeriodSeconds("month")! + 1,
        period: "month",
        remainingAmount: 250n,
      })
    ).toBe(1_000n);
  });

  test("does not reset recurring limits exactly on the reset boundary", () => {
    expect(
      getEffectiveSpendingLimitRemainingAmount({
        amount: 1_000n,
        lastReset: 1_000,
        now: 1_000 + getSpendingLimitPeriodSeconds("month")!,
        period: "month",
        remainingAmount: 250n,
      })
    ).toBe(250n);
  });

  test("adds missed periods for accumulated limits", () => {
    expect(
      getEffectiveSpendingLimitRemainingAmount({
        accumulateUnused: true,
        amount: 1_000n,
        lastReset: 1_000,
        now: 1_000 + 2 * getSpendingLimitPeriodSeconds("week")! + 1,
        period: "week",
        remainingAmount: 250n,
      })
    ).toBe(2_250n);
  });

  test("never virtually resets one-time limits", () => {
    expect(
      getEffectiveSpendingLimitRemainingAmount({
        amount: 1_000n,
        lastReset: 1_000,
        now: 10_000_000,
        period: "one_time",
        remainingAmount: 250n,
      })
    ).toBe(250n);
  });

  test("formats raw token amounts without floating point drift", () => {
    expect(formatTokenAmount(123_456_789n, 6)).toBe("123.456789");
    expect(formatTokenAmount(1_230_000n, 6)).toBe("1.23");
    expect(formatTokenAmount(42n, 0)).toBe("42");
  });

  test("calculates the next reset timestamp", () => {
    expect(
      getSpendingLimitNextReset({
        lastReset: 1_000,
        now: 1_000 + 2 * getSpendingLimitPeriodSeconds("week")! + 5,
        period: "week",
      })
    ).toBe(1_000 + 3 * getSpendingLimitPeriodSeconds("week")!);
    expect(
      getSpendingLimitNextReset({
        lastReset: 1_000,
        now: 2_000,
        period: "one_time",
      })
    ).toBeNull();
  });
});
