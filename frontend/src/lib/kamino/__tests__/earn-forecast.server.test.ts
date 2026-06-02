import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  computeSafeNoFeeEarnForecast,
  getSafeNoFeeEarnForecastFromClient,
} = await import("../earn-forecast.server");
const { FALLBACK_EARN_FORECAST } = await import("../earn-forecast.shared");

function row(
  overrides: Partial<Parameters<typeof computeSafeNoFeeEarnForecast>[0][number]>
): Parameters<typeof computeSafeNoFeeEarnForecast>[0][number] {
  return {
    market: "main-market",
    marketName: "Main",
    observedAt: new Date("2026-05-01T00:00:00.000Z"),
    reserve: "reserve-1",
    reserveLastUpdateStale: false,
    supplyApy: 0.1,
    symbol: "USDC",
    totalSupplyUsdEstimate: 1_000_000,
    ...overrides,
  };
}

describe("earn forecast", () => {
  test("computes time-weighted Safe no-fee APY and range", () => {
    const forecast = computeSafeNoFeeEarnForecast(
      [
        row({
          observedAt: new Date("2026-05-01T00:00:00.000Z"),
          reserve: "reserve-low",
          supplyApy: 0.08,
        }),
        row({
          observedAt: new Date("2026-05-01T00:00:00.000Z"),
          reserve: "reserve-best",
          supplyApy: 0.1,
        }),
        row({
          observedAt: new Date("2026-05-02T00:00:00.000Z"),
          reserve: "reserve-mid",
          supplyApy: 0.2,
        }),
        row({
          observedAt: new Date("2026-05-04T00:00:00.000Z"),
          reserve: "reserve-high",
          supplyApy: 0.3,
        }),
      ],
      new Date("2026-05-05T00:00:00.000Z")
    );

    expect(forecast).toEqual({
      apyBps: 2000,
      rangeHighBps: 2000,
      rangeLowBps: 1000,
      strategy: "safe_no_fees",
      updatedAt: "2026-05-05T00:00:00.000Z",
      window: {
        endedAt: "2026-05-04T00:00:00.000Z",
        startedAt: "2026-05-01T00:00:00.000Z",
      },
    });
  });

  test("filters stale, low-TVL, outlier, non-stable, and non-Safe rows", () => {
    const forecast = computeSafeNoFeeEarnForecast(
      [
        row({ reserve: "eligible", supplyApy: 0.12 }),
        row({ reserve: "stale", reserveLastUpdateStale: true, supplyApy: 0.49 }),
        row({ reserve: "low-tvl", supplyApy: 0.49, totalSupplyUsdEstimate: 99_999 }),
        row({ reserve: "outlier", supplyApy: 0.5 }),
        row({ reserve: "non-stable", supplyApy: 0.49, symbol: "SOL" }),
        row({ marketName: "Degen", reserve: "non-safe", supplyApy: 0.49 }),
      ],
      new Date("2026-05-02T00:00:00.000Z")
    );

    expect(forecast?.apyBps).toBe(1200);
    expect(forecast?.rangeLowBps).toBe(1200);
    expect(forecast?.rangeHighBps).toBe(1200);
  });

  test("falls back cleanly when Timescale throws", async () => {
    const forecast = await getSafeNoFeeEarnForecastFromClient({
      close: async () => {},
      getSafeNoFeeReserveUpdates: async () => {
        throw new Error("timescale unavailable");
      },
    });

    expect(forecast).toEqual(FALLBACK_EARN_FORECAST);
  });
});
