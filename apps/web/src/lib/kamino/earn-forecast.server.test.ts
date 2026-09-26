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
    points.push({ observedAtMs: t, sharePrice: (1 + apy) ** ((t - start) / YEAR) });
  }
  return points;
}

const realizedDeps = {
  cluster: "mainnet-beta",
  loadHistories: async () =>
    new Map([
      [AYL4, history(0.065, 10)],
      [D6Q6, history(0.045, 10)],
    ]),
  loadWeights: async () => new Map([[AYL4, 1_000_000]]),
};

describe("realized Earn forecast", () => {
  beforeEach(async () => {
    delete process.env.TIMESCALEDB_URL;
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
      source: "realized_7d",
      strategy: "realized_7d_share_price",
    });
    expect(forecast.history.series?.map((s) => s.key)).toEqual([
      "loyal",
      "mainUsdcReserve",
    ]);
    expect(forecast.history.samples.at(-1)?.apyBps).toBe(650);
    expect(
      forecast.history.series?.find((s) => s.key === "mainUsdcReserve")
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
      loadWeights: async () => {
        throw new Error("db down");
      },
    });
    expect(forecast.summary.strategy).toBe("realized_7d_share_price");
    expect(forecast.summary.apyBps).toBe(650);
    resetEarnForecastCacheForTests();
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

  test("the daily simulation cron no longer overwrites the served value", async () => {
    const {
      getMediumFeeAwareEarnForecast,
      refreshMediumFeeAwareEarnForecastSnapshot,
    } = await import("./earn-forecast.server");
    await refreshMediumFeeAwareEarnForecastSnapshot(NOW);
    const forecast = await getMediumFeeAwareEarnForecast(NOW, realizedDeps);
    expect(forecast.summary.strategy).toBe("realized_7d_share_price");
  });
});
