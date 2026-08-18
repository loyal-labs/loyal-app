import { describe, expect, test } from "bun:test";

import { buildLogTicks, formatLogTick } from "./earn-vault-rebalance-axis";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("buildLogTicks", () => {
  test("keeps the live mainnet deposit range readable", () => {
    // Mainnet funded deposits currently run from one raw unit (0.000001) to
    // ~100.3k, which is thirteen decades.
    const ticks = buildLogTicks(0.000001, 100_322.41);

    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks[0]).toBeCloseTo(0.000001, 12);
    expect(ticks[ticks.length - 1]).toBe(10 ** 6);
  });

  test("covers the whole data range", () => {
    const min = 0.01;
    const max = 5_000;
    const ticks = buildLogTicks(min, max);

    expect(ticks[0]).toBeLessThanOrEqual(min);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
  });

  test("emits ascending powers of ten", () => {
    const ticks = buildLogTicks(0.001, 1_000_000);

    for (const tick of ticks) {
      const exponent = Math.log10(tick);
      expect(Math.abs(exponent - Math.round(exponent))).toBeLessThan(1e-9);
    }
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index]).toBeGreaterThan(ticks[index - 1]);
    }
  });

  test("handles a single-value range without looping forever", () => {
    expect(buildLogTicks(100, 100)).toEqual([100]);
  });

  test("falls back safely on non-positive or infinite input", () => {
    expect(buildLogTicks(0, 100)).toEqual([1]);
    expect(buildLogTicks(-5, 100)).toEqual([1]);
    expect(buildLogTicks(1, Number.POSITIVE_INFINITY)).toEqual([1]);
  });
});

describe("formatLogTick", () => {
  test("compacts large amounts and spells out small ones", () => {
    expect(formatLogTick(100_000, USDC_MINT)).toBe("100K USDC");
    expect(formatLogTick(1_000, USDC_MINT)).toBe("1K USDC");
    expect(formatLogTick(1, USDC_MINT)).toBe("1 USDC");
    expect(formatLogTick(0.01, USDC_MINT)).toBe("0.01 USDC");
    expect(formatLogTick(0.000001, USDC_MINT)).toBe("0.000001 USDC");
  });

  test("falls back to a neutral unit for an unknown mint", () => {
    expect(formatLogTick(1, null)).toBe("1 USD");
  });
});
