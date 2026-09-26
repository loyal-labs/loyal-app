import { describe, expect, test } from "bun:test";

import {
  computeRealizedApy,
  type SharePricePoint,
} from "./earn-realized-apy.shared";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const NOW = Date.parse("2026-10-01T12:05:00.000Z");
const A = "reserveA";
const B = "reserveB";
const BENCH = "benchmark";

// Hourly points ending at `endMs`, growing at a constant annual rate.
function history(
  apy: number,
  days: number,
  endMs = NOW,
  startPrice = 1.2
): SharePricePoint[] {
  const points: SharePricePoint[] = [];
  const startMs = endMs - days * DAY;
  for (let t = startMs; t <= endMs; t += HOUR) {
    points.push({
      observedAtMs: t,
      sharePrice: startPrice * (1 + apy) ** ((t - startMs) / YEAR),
    });
  }
  return points;
}

function run(
  histories: [string, SharePricePoint[]][],
  weights: [string, number][]
) {
  return computeRealizedApy({
    benchmarkReserve: BENCH,
    histories: new Map(histories),
    nowMs: NOW,
    weights: new Map(weights),
  });
}

describe("computeRealizedApy", () => {
  test("constant growth gives the same realized and live APY", () => {
    const result = run([[A, history(0.065, 8)]], [[A, 1]]);
    expect(result).toMatchObject({
      headlineBps: 650,
      liveBps: 650,
      realized7dBps: 650,
      source: "realized_7d",
    });
  });

  test("uses live when there is under 7 days of history", () => {
    const result = run([[A, history(0.065, 3)]], [[A, 1]]);
    expect(result).toMatchObject({
      headlineBps: 650,
      liveBps: 650,
      realized7dBps: null,
      source: "live",
    });
  });

  test("headline stays on realized 7d even when live is higher", () => {
    const older = history(0.05, 7, NOW - DAY);
    const last = older[older.length - 1];
    const recent = history(0.1, 1, NOW, last.sharePrice).slice(1);
    const result = run([[A, [...older, ...recent]]], [[A, 1]]);
    expect(result?.source).toBe("realized_7d");
    expect(result?.liveBps).toBe(1000);
    const realized = result?.realized7dBps ?? 0;
    expect(realized).toBeGreaterThan(500);
    expect(realized).toBeLessThan(1000);
    expect(result?.headlineBps).toBe(realized);
  });

  test("weights reserves by Earn AUM", () => {
    const result = run(
      [
        [A, history(0.06, 8)],
        [B, history(0.04, 8)],
      ],
      [
        [A, 3],
        [B, 1],
      ]
    );
    expect(result?.realized7dBps).toBe(550);
  });

  test("returns null when weighted reserves with history cover under 90% of AUM", () => {
    const result = run(
      [[A, history(0.06, 8)]],
      [
        [A, 8],
        [B, 2],
      ]
    );
    expect(result).toBeNull();
  });

  test("ignores a small reserve without history", () => {
    const result = run(
      [[A, history(0.06, 8)]],
      [
        [A, 95],
        [B, 5],
      ]
    );
    expect(result?.realized7dBps).toBe(600);
  });

  test("treats a reserve with no point in the last 3 hours as missing", () => {
    const result = run([[A, history(0.06, 8, NOW - 5 * HOUR)]], [[A, 1]]);
    expect(result).toBeNull();
  });

  test("a gap over 6 hours at the window start breaks realized but not live", () => {
    const start = NOW - 7 * DAY;
    const points = history(0.06, 8).filter(
      (point) =>
        point.observedAtMs < start - 6 * HOUR ||
        point.observedAtMs > start + 6 * HOUR
    );
    const result = run([[A, points]], [[A, 1]]);
    expect(result?.realized7dBps).toBeNull();
    expect(result?.liveBps).toBe(600);
    expect(result?.source).toBe("live");
  });

  test("clamps negative growth to 0", () => {
    const result = run([[A, history(-0.02, 8)]], [[A, 1]]);
    expect(result?.headlineBps).toBe(0);
  });

  test("builds hourly rolling series for Loyal and the benchmark", () => {
    const result = run(
      [
        [A, history(0.065, 10)],
        [BENCH, history(0.045, 10)],
      ],
      [[A, 1]]
    );
    expect(result?.loyalSeries.length).toBeGreaterThan(60);
    expect(result?.loyalSeries.every((s) => s.apyBps === 650)).toBe(true);
    expect(result?.mainUsdcReserveSeries.every((s) => s.apyBps === 450)).toBe(
      true
    );
    const first = Date.parse(result!.loyalSeries[0].observedAt);
    expect(first).toBeGreaterThanOrEqual(NOW - 10 * DAY + 7 * DAY);
  });

  // Dangerous pure calculation: this is the exact bug the fix corrects — a
  // losing reserve (share price decline from loss socialization) must pull
  // the weighted headline down, not get floored to 0 before weighting and so
  // silently disappear from (and inflate) the blended APY.
  test("weights a losing reserve down instead of flooring it to 0 before weighting", () => {
    const result = run(
      [
        [A, history(0.06, 8)],
        [B, history(-0.1, 8)],
      ],
      [
        [A, 8],
        [B, 2],
      ]
    );
    // 0.8 * 600bps + 0.2 * (-1000bps) = 280bps, not
    // 0.8 * 600bps + 0.2 * max(0, -1000bps) = 480bps.
    expect(result?.realized7dBps).toBe(280);
  });
});
