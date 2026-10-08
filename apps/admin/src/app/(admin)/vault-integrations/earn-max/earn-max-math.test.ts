import { describe, expect, test } from "bun:test";

import {
  apyHistory,
  earnedSinceEmpty,
  loanToValue,
  realizedApy,
} from "./earn-max-math";

describe("earnedSinceEmpty", () => {
  test("counts only flows since the vault was last empty", () => {
    const result = earnedSinceEmpty(
      [
        // Old cycle: deposit 100, full withdrawal 105; the vault is empty after.
        { blockTime: 1, idleDelta: 100e6, lpNet: 100 },
        { blockTime: 2, idleDelta: -105e6, lpNet: -100 },
        // Live cycle (given out of order): deposit 1,000, withdraw 50.
        { blockTime: 4, idleDelta: -50e6, lpNet: -40 },
        { blockTime: 3, idleDelta: 1_000e6, lpNet: 800 },
        // A tx that did not mint or burn LP is not a user flow.
        { blockTime: 5, idleDelta: 7e6, lpNet: 0 },
      ],
      960
    );

    expect(result.deposits).toBe(1_000);
    expect(result.withdrawals).toBe(50);
    expect(result.earned).toBeCloseTo(10, 9);
    expect(result.flows).toBe(2);
    expect(result.since).toBe(new Date(3000).toISOString());
  });
});

describe("loanToValue", () => {
  test("leaves custody cash out of the Kamino collateral", () => {
    expect(loanToValue(1_200, 900, 100)).toBeCloseTo(0.45, 12);
    expect(loanToValue(0, 0, 0)).toBeNull();
  });
});

describe("realizedApy", () => {
  test("uses the newest point at least 6.5 days old and skips today", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const result = realizedApy(
      [
        { day: "2026-09-20", price: 0.9 },
        { day: "2026-09-23", price: 1 },
        { day: "2026-09-24", price: 1.5 },
        { day: "2026-09-30", price: 9 },
      ],
      1.01,
      now
    );
    const years =
      (now - Date.parse("2026-09-23T23:59:59Z")) / (365 * 86_400_000);

    expect(result?.since).toBe("2026-09-23");
    expect(result?.apy).toBeCloseTo(1.01 ** (1 / years) - 1, 12);
  });

  test("needs 12 hours of history", () => {
    const now = Date.parse("2026-09-30T06:00:00Z");
    expect(
      realizedApy([{ day: "2026-09-29", price: 1 }], 1.01, now)
    ).toBeNull();
  });
});

describe("apyHistory", () => {
  test("each point's 7-day figure equals the badge rule as of that day", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const daily = [
      { day: "2026-09-22", price: 1 },
      { day: "2026-09-23", price: 1.001 },
      { day: "2026-09-29", price: 1.002 },
    ];
    const history = apyHistory(daily, 1.0025, now);

    expect(history).toHaveLength(3);
    // The last point is the live badge value.
    expect(history[2].sevenDayApy).toBeCloseTo(
      realizedApy(daily, 1.0025, now)!.apy,
      12
    );
    // One day of growth, annualized.
    expect(history[0].dayApy).toBeCloseTo(1.001 ** 365 - 1, 9);
    // Today is not a finished day.
    expect(history[2].dayApy).toBeNull();
  });
});
