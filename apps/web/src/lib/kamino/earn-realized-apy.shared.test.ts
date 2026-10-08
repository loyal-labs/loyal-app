import { describe, expect, test } from "bun:test";

import {
  computeRealizedApy,
  type EarnAllocationHistory,
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
  weights: [string, number][],
  allocations: EarnAllocationHistory = allocationHistory(() => weights)
) {
  return computeRealizedApy({
    allocations,
    benchmarkReserve: BENCH,
    histories: new Map(histories),
    nowMs: NOW,
  });
}

function allocationHistory(
  weightsAt: (atMs: number) => [string, number][],
  overrides: Partial<EarnAllocationHistory> = {}
): EarnAllocationHistory {
  const start = NOW - 10 * DAY;
  const snapshots = [];
  for (let at = start; at <= NOW; at += 5 * HOUR) {
    snapshots.push({
      idleAmountRaw: 0,
      observedAtMs: at,
      unsupported: false,
      vaultId: "one",
      weights: new Map(weightsAt(at)),
    });
  }
  return {
    currentIdleMismatch: false,
    snapshots,
    vaults: [{ firstSeenAtMs: start, id: "one" }],
    ...overrides,
  };
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

  test("a rebalance changes only subsequent returns and preserves earlier chart hours", () => {
    const allocations = allocationHistory((at) =>
      at < NOW - DAY ? [[A, 1]] : [[B, 1]]
    );
    const result = run(
      [
        [A, history(0.04, 10)],
        [B, history(0.16, 10)],
      ],
      [[B, 1]],
      allocations
    );
    expect(result?.realized7dBps).toBeGreaterThan(500);
    expect(result?.realized7dBps).toBeLessThan(700);
    const before = result?.loyalSeries.find(
      (sample) => Date.parse(sample.observedAt) === NOW - DAY - 5 * 60 * 1000
    );
    expect(before?.apyBps).toBe(400);
  });

  test("hourly as-of sampling applies an intra-hour rebalance at the next hour", () => {
    const firstHour = NOW - 10 * DAY - 5 * 60 * 1000;
    const rebalanceAt = NOW - 2 * DAY;
    const snapshots = [];
    for (let hour = firstHour; hour <= NOW; hour += HOUR) {
      snapshots.push({
        idleAmountRaw: 0,
        observedAtMs: hour,
        unsupported: false,
        vaultId: "fleet",
        weights: new Map([[hour < rebalanceAt ? A : B, 1]]),
      });
    }
    const result = run(
      [
        [A, history(0.04, 10)],
        [B, history(0.16, 10)],
      ],
      [[B, 1]],
      {
        currentIdleMismatch: false,
        snapshots,
        vaults: [{ firstSeenAtMs: firstHour, id: "fleet" }],
      }
    );
    const prior = result?.loyalSeries.find(
      (sample) => Date.parse(sample.observedAt) === rebalanceAt - 5 * 60 * 1000
    );
    const next = result?.loyalSeries.find(
      (sample) =>
        Date.parse(sample.observedAt) === rebalanceAt + 115 * 60 * 1000
    );
    expect(prior?.apyBps).toBe(400);
    expect(next?.apyBps).toBeGreaterThan(400);
  });

  test("a fleet sweep after the latest share price does not invalidate an unchanged allocation", () => {
    const allocations = allocationHistory(() => [[A, 1]]);
    allocations.snapshots.push({
      idleAmountRaw: 0,
      observedAtMs: NOW - 60_000,
      unsupported: false,
      vaultId: "one",
      weights: new Map([[A, 1]]),
    });
    const prices = history(0.06, 10, NOW - 5 * 60_000);
    const result = run([[A, prices]], [[A, 1]], allocations);
    expect(result?.headlineBps).toBe(600);
    expect(result?.measuredAtMs).toBe(NOW - 5 * 60_000);
  });

  test("staggered reserve price samples interpolate to a common timestamp", () => {
    const a = history(0.04, 10, NOW - 4 * 60_000);
    const b = history(0.16, 10, NOW - 3 * 60_000);
    const result = run(
      [
        [A, a],
        [B, b],
      ],
      [
        [A, 1],
        [B, 1],
      ]
    );
    expect(result?.measuredAtMs).toBe(NOW - 4 * 60_000);
    expect(result?.headlineBps).toBeGreaterThan(900);
    expect(result?.headlineBps).toBeLessThan(1100);
  });

  test("future share prices cannot become the measurement timestamp", () => {
    const prices = history(0.06, 10, NOW + HOUR);
    const result = run([[A, prices]], [[A, 1]]);
    expect(result?.measuredAtMs).toBeLessThanOrEqual(NOW);
  });

  test("rejects unknown units, current idle mismatch, and missing allocation coverage", () => {
    const prices: [string, SharePricePoint[]][] = [[A, history(0.06, 10)]];
    const base = allocationHistory(() => [[A, 1]]);
    expect(
      run(prices, [[A, 1]], { ...base, currentIdleMismatch: true })
    ).toBeNull();
    const damaged = run(prices, [[A, 1]], {
      ...base,
      snapshots: base.snapshots.map((snapshot, index) =>
        index === 20 ? { ...snapshot, unsupported: true } : snapshot
      ),
    });
    expect(damaged?.realized7dBps).toBeNull();
    expect(damaged?.source).toBe("live");
    expect(
      run(prices, [[A, 1]], {
        ...base,
        snapshots: base.snapshots.slice(0, -3),
      })
    ).toBeNull();
  });

  test("counts documented idle balance as zero earning capital", () => {
    const base = allocationHistory(() => [[A, 1]]);
    const allocations = {
      ...base,
      snapshots: base.snapshots.map((snapshot) => ({
        ...snapshot,
        idleAmountRaw: 1,
      })),
    };
    const result = run([[A, history(0.06, 10)]], [[A, 1]], allocations);
    expect(result?.realized7dBps).toBe(296);
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
    // Compounded segment growth yields about 259bps; flooring losses first
    // would materially inflate the displayed rate.
    expect(result?.realized7dBps).toBe(259);
  });
});
