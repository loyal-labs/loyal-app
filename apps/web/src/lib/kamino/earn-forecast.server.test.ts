import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const NOW = new Date("2026-10-01T12:05:00.000Z");
const AYL4 = "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z";
const D6Q6 = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";

function history(apy: number, days: number) {
  const points = [];
  const start = NOW.getTime() - days * DAY;
  for (let t = start; t <= NOW.getTime(); t += HOUR) {
    points.push({
      observedAtMs: t,
      sharePrice: (1 + apy) ** ((t - start) / YEAR),
    });
  }
  return points;
}

const realizedDeps = {
  cluster: "mainnet-beta",
  loadAllocations: async () => {
    const snapshots = [];
    const start = NOW.getTime() - 10 * DAY;
    for (let at = start; at <= NOW.getTime(); at += 5 * HOUR) {
      snapshots.push({
        idleAmountRaw: 0,
        observedAtMs: at,
        unsupported: false,
        vaultId: "one",
        weights: new Map([[AYL4, 1_000_000]]),
      });
    }
    return {
      currentIdleMismatch: false,
      snapshots,
      vaults: [{ firstSeenAtMs: start, id: "one" }],
    };
  },
  loadHistories: async () =>
    new Map([
      [AYL4, history(0.065, 10)],
      [D6Q6, history(0.045, 10)],
    ]),
};

describe("realized Earn forecast", () => {
  beforeEach(async () => {
    const { resetEarnForecastCacheForTests } = await import(
      "./earn-forecast.server"
    );
    resetEarnForecastCacheForTests();
  });

  test("maps the realized result into the existing response shape", async () => {
    const { getMediumFeeAwareEarnForecast } = await import(
      "./earn-forecast.server"
    );
    const forecast = await getMediumFeeAwareEarnForecast(NOW, realizedDeps);

    expect(forecast.summary).toMatchObject({
      apyBps: 650,
      availability: "available",
      source: "realized_7d",
      strategy: "realized_7d_share_price",
    });
    expect(forecast.history.series?.map((s) => s.key)).toEqual([
      "loyal",
      "mainUsdcReserve",
    ]);
    expect(forecast.history.samples.at(-1)?.apyBps).toBe(650);
    expect(
      forecast.history.series
        ?.find((s) => s.key === "mainUsdcReserve")
        ?.samples.at(-1)?.apyBps
    ).toBe(450);
  });

  test("keeps serving the last realized result when a read fails", async () => {
    const { getMediumFeeAwareEarnForecast, resetEarnForecastCacheForTests } =
      await import("./earn-forecast.server");
    await getMediumFeeAwareEarnForecast(NOW, realizedDeps);

    // expire the 5-minute cache but keep the last good value
    const later = new Date(NOW.getTime() + 10 * 60 * 1000);
    const forecast = await getMediumFeeAwareEarnForecast(later, {
      ...realizedDeps,
      loadAllocations: async () => {
        throw new Error("db down");
      },
    });
    expect(forecast.summary.strategy).toBe("realized_7d_share_price");
    expect(forecast.summary.availability).toBe("stale");
    expect(forecast.summary.apyBps).toBe(650);
    resetEarnForecastCacheForTests();
  });

  test("stops recaching a realized rate after its data freshness bound", async () => {
    const { getMediumFeeAwareEarnForecast } = await import(
      "./earn-forecast.server"
    );
    await getMediumFeeAwareEarnForecast(NOW, realizedDeps);
    const failing = {
      ...realizedDeps,
      loadAllocations: async () => {
        throw new Error("db down");
      },
    };
    const stillFresh = await getMediumFeeAwareEarnForecast(
      new Date(NOW.getTime() + 2 * HOUR),
      failing
    );
    expect(stillFresh.summary.strategy).toBe("realized_7d_share_price");
    expect(stillFresh.summary.availability).toBe("stale");

    const stale = await getMediumFeeAwareEarnForecast(
      new Date(NOW.getTime() + 4 * HOUR),
      failing
    );
    expect(stale.summary.strategy).toBe("safe_no_fees");
    expect(stale.summary.availability).toBe("unavailable");
    expect(stale.history.samples).toEqual([]);
  });

  test("falls back to the conservative constant with no realized data ever", async () => {
    const { getMediumFeeAwareEarnForecast } = await import(
      "./earn-forecast.server"
    );
    const forecast = await getMediumFeeAwareEarnForecast(NOW, {
      ...realizedDeps,
      loadHistories: async () => new Map(),
    });
    expect(forecast.summary.apyBps).toBe(600);
    expect(forecast.summary.strategy).toBe("safe_no_fees");
  });

  test("skips the vault history query when the share-price table has no observations", async () => {
    const { getMediumFeeAwareEarnForecast } = await import(
      "./earn-forecast.server"
    );
    let allocationReads = 0;
    const forecast = await getMediumFeeAwareEarnForecast(NOW, {
      ...realizedDeps,
      hasRecentPrices: async () => false,
      loadAllocations: async () => {
        allocationReads += 1;
        return realizedDeps.loadAllocations();
      },
    });
    expect(allocationReads).toBe(0);
    expect(forecast.summary.availability).toBe("unavailable");
  });
});
