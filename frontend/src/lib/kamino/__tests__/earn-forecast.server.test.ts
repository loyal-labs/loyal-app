import { describe, expect, mock, test } from "bun:test";

import { STABLECOIN_MINTS } from "@loyal/actions/constants";
import { Stablecoin } from "@loyal/actions/types";

mock.module("server-only", () => ({}));

const {
  computeMediumFeeAwareEarnForecast,
  getMediumFeeAwareEarnForecastFromClient,
  timescaleReserveApySamplesToEarnHistorySamples,
} = await import("../earn-forecast.server");
const { FALLBACK_EARN_FORECAST } = await import("../earn-forecast.shared");

const USDC_MINT = STABLECOIN_MINTS[Stablecoin.USDC].toBase58();
const USDT_MINT = STABLECOIN_MINTS[Stablecoin.USDT].toBase58();

type SupportedReserve = Parameters<
  typeof computeMediumFeeAwareEarnForecast
>[0]["supportedReserves"][number];
type ReserveRow = Parameters<
  typeof computeMediumFeeAwareEarnForecast
>[0]["rows"][number];

function supported(overrides: Partial<SupportedReserve>): SupportedReserve {
  return {
    active: true,
    liquidityMint: USDC_MINT,
    market: "medium-market",
    marketName: "Main",
    reserve: "reserve-usdc",
    symbol: "USDC",
    ...overrides,
  };
}

function row(overrides: Partial<ReserveRow>): ReserveRow {
  return {
    liquidityMint: USDC_MINT,
    market: "medium-market",
    marketName: "Main",
    observedAt: new Date("2026-05-01T00:00:00.000Z"),
    reserve: "reserve-usdc",
    reserveLastUpdateStale: false,
    supplyApy: 0.1,
    symbol: "USDC",
    totalSupplyUsdEstimate: 1_000_000,
    ...overrides,
  };
}

describe("earn forecast", () => {
  test("summary APY uses compounded annualized 30D return", () => {
    const forecast = computeMediumFeeAwareEarnForecast(
      {
        rows: [row({ supplyApy: 0.1 })],
        supportedReserves: [supported({})],
      },
      new Date("2026-05-31T00:00:00.000Z")
    );

    expect(forecast?.summary).toMatchObject({
      apyBps: 1000,
      strategy: "medium_fee_aware_1bps",
      window: {
        endedAt: "2026-05-31T00:00:00.000Z",
        startedAt: "2026-05-01T00:00:00.000Z",
      },
    });
    expect(forecast?.history.samples).toEqual([
      {
        apyBps: 1000,
        observedAt: "2026-05-31T00:00:00.000Z",
      },
    ]);
  });

  test("cross-mint switch charges 1bps while same-mint routing is free", () => {
    const now = new Date("2026-05-31T00:00:00.000Z");
    const crossMint = computeMediumFeeAwareEarnForecast(
      {
        rows: [
          row({
            liquidityMint: USDT_MINT,
            reserve: "reserve-usdt",
            supplyApy: 0.1,
            symbol: "USDT",
          }),
        ],
        supportedReserves: [
          supported({
            liquidityMint: USDT_MINT,
            reserve: "reserve-usdt",
            symbol: "USDT",
          }),
        ],
      },
      now
    );
    const sameMint = computeMediumFeeAwareEarnForecast(
      {
        rows: [row({ reserve: "reserve-usdc-a", supplyApy: 0.1 })],
        supportedReserves: [supported({ reserve: "reserve-usdc-a" })],
      },
      now
    );

    expect(crossMint?.summary.apyBps).toBeLessThan(1000);
    expect(sameMint?.summary.apyBps).toBe(1000);
  });

  test("same-mint reserve switch is free", () => {
    const forecast = computeMediumFeeAwareEarnForecast(
      {
        rows: [
          row({
            observedAt: new Date("2026-05-01T00:00:00.000Z"),
            reserve: "reserve-usdc-a",
            supplyApy: 0.05,
          }),
          row({
            observedAt: new Date("2026-05-16T00:00:00.000Z"),
            reserve: "reserve-usdc-b",
            supplyApy: 0.15,
          }),
        ],
        supportedReserves: [
          supported({ reserve: "reserve-usdc-a" }),
          supported({ reserve: "reserve-usdc-b" }),
        ],
      },
      new Date("2026-05-31T00:00:00.000Z")
    );

    expect(forecast?.summary.apyBps).toBe(989);
  });

  test("USDC cash baseline prevents negative net routing", () => {
    const forecast = computeMediumFeeAwareEarnForecast(
      {
        rows: [
          row({
            liquidityMint: USDT_MINT,
            reserve: "reserve-usdt",
            supplyApy: 0,
            symbol: "USDT",
          }),
        ],
        supportedReserves: [
          supported({
            liquidityMint: USDT_MINT,
            reserve: "reserve-usdt",
            symbol: "USDT",
          }),
        ],
      },
      new Date("2026-05-31T00:00:00.000Z")
    );

    expect(forecast?.summary.apyBps).toBe(0);
  });

  test("filters stale, low-TVL, outlier, and unsupported rows", () => {
    const forecast = computeMediumFeeAwareEarnForecast(
      {
        rows: [
          row({ reserve: "eligible", supplyApy: 0.12 }),
          row({
            reserve: "stale",
            reserveLastUpdateStale: true,
            supplyApy: 0.49,
          }),
          row({
            reserve: "low-tvl",
            supplyApy: 0.49,
            totalSupplyUsdEstimate: 99_999,
          }),
          row({ reserve: "outlier", supplyApy: 0.5 }),
          row({ reserve: "unsupported", supplyApy: 0.49 }),
        ],
        supportedReserves: [supported({ reserve: "eligible" })],
      },
      new Date("2026-05-31T00:00:00.000Z")
    );

    expect(forecast?.summary.apyBps).toBe(1200);
  });

  test("stores hourly APY history samples for the 30D chart", () => {
    const start = Date.parse("2026-05-01T00:00:00.000Z");
    const minuteMs = 60 * 1000;
    const rows = Array.from({ length: 30 * 24 * 60 }, (_, index) =>
      row({
        observedAt: new Date(start + index * minuteMs),
        supplyApy: 0.08 + (index % 17) / 10_000,
      })
    );
    const forecast = computeMediumFeeAwareEarnForecast(
      {
        rows,
        supportedReserves: [supported({})],
      },
      new Date("2026-05-31T00:00:00.000Z")
    );

    expect(forecast?.history.samples.length).toBeLessThanOrEqual(30 * 24 + 1);
    expect(forecast?.history.samples.at(0)?.observedAt).toBe(
      "2026-05-01T00:59:00.000Z"
    );
    expect(forecast?.history.samples.at(-1)?.observedAt).toBe(
      "2026-05-31T00:00:00.000Z"
    );
  });

  test("converts Main USDC reserve Timescale rows into cumulative annualized APY samples", () => {
    expect(
      timescaleReserveApySamplesToEarnHistorySamples(
        [
          {
            observedAt: new Date("2026-04-30T00:00:00.000Z"),
            supplyApy: 0.05234,
          },
          {
            observedAt: new Date("2026-05-15T00:00:00.000Z"),
            supplyApy: 0.056,
          },
        ],
        {
          windowEndedAt: new Date("2026-05-31T00:00:00.000Z"),
          windowStartedAt: new Date("2026-05-01T00:00:00.000Z"),
        }
      )
    ).toEqual([
      { apyBps: 523, observedAt: "2026-05-15T00:00:00.000Z" },
      { apyBps: 543, observedAt: "2026-05-31T00:00:00.000Z" },
    ]);
  });

  test("Main USDC cumulative history applies APY changes inside the window", () => {
    expect(
      timescaleReserveApySamplesToEarnHistorySamples(
        [
          {
            observedAt: new Date("2026-04-30T00:00:00.000Z"),
            supplyApy: 0.04,
          },
          {
            observedAt: new Date("2026-05-01T01:00:00.000Z"),
            supplyApy: 0.08,
          },
        ],
        {
          windowEndedAt: new Date("2026-05-31T00:00:00.000Z"),
          windowStartedAt: new Date("2026-05-01T00:00:00.000Z"),
        }
      )
    ).toEqual([
      { apyBps: 400, observedAt: "2026-05-01T01:00:00.000Z" },
      { apyBps: 799, observedAt: "2026-05-31T00:00:00.000Z" },
    ]);
  });

  test("adds Loyal and Main USDC series from one Timescale refresh", async () => {
    const forecast = await getMediumFeeAwareEarnForecastFromClient(
      {
        close: async () => {},
        getMediumStableSupportedReserves: async () => [supported({})],
        getReserveApyHistorySamples: async () => [
          {
            observedAt: new Date("2026-05-01T00:00:00.000Z"),
            supplyApy: 0.056,
          },
        ],
        getReserveUpdatesWithSeedRows: async () => [row({ supplyApy: 0.1 })],
      },
      new Date("2026-05-31T00:00:00.000Z")
    );

    expect(forecast.history.series?.map((series) => series.key)).toEqual([
      "loyal",
      "mainUsdcReserve",
    ]);
    expect(
      forecast.history.series?.map((series) => series.metadata?.metric)
    ).toEqual([
      "cumulative_annualized_apy_bps",
      "cumulative_annualized_apy_bps",
    ]);
    expect(
      forecast.history.series?.find(
        (series) => series.key === "mainUsdcReserve"
      )?.samples
    ).toEqual([{ apyBps: 560, observedAt: "2026-05-31T00:00:00.000Z" }]);
  });

  test("falls back cleanly when Timescale throws", async () => {
    const forecast = await getMediumFeeAwareEarnForecastFromClient({
      close: async () => {},
      getReserveApyHistorySamples: async () => [],
      getMediumStableSupportedReserves: async () => {
        throw new Error("timescale unavailable");
      },
      getReserveUpdatesWithSeedRows: async () => [],
    });

    expect(forecast.summary).toEqual(FALLBACK_EARN_FORECAST);
    expect(forecast.history.samples).toEqual([]);
    expect(forecast.history.series?.map((series) => series.key)).toEqual([
      "loyal",
      "mainUsdcReserve",
    ]);
  });
});
