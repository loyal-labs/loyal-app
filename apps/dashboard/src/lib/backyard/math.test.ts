import { describe, expect, test } from "bun:test";

import { loanToValue, windowApy } from "./math";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const daily = [
  { day: "2026-10-01", price: 100 },
  { day: "2026-10-20", price: 101 },
  { day: "2026-11-05", price: 102 },
];

describe("windowApy", () => {
  test("starts at the last day-end at or before the window start", () => {
    const result = windowApy(daily, 103, NOW, 7);
    // 7 days back is Oct 30: the last price on or before it is Oct 20.
    expect(result?.since).toBe("2026-10-20");
    const years =
      (NOW - Date.parse("2026-10-20T23:59:59Z")) / (365 * 86_400_000);
    expect(result?.apy).toBeCloseTo((103 / 101) ** (1 / years) - 1, 10);
  });

  test("falls back to the first price when history is shorter than the window", () => {
    const result = windowApy(daily, 103, NOW, 365);
    expect(result?.since).toBe("2026-10-01");
    expect(result!.days).toBeLessThan(365);
  });

  test("ignores today's unfinished point and needs 12 hours", () => {
    expect(windowApy([{ day: "2026-11-06", price: 1 }], 1, NOW, 30)).toBeNull();
  });
});

describe("loanToValue", () => {
  test("takes custody cash out of the collateral", () => {
    // NAV 100 + debt 150 - 10 cash = 240 collateral in Kamino.
    expect(loanToValue(100, 150, 10)).toBeCloseTo(150 / 240, 10);
    expect(loanToValue(0, 0, 0)).toBeNull();
  });
});
