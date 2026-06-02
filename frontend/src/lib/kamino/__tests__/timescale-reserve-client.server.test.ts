import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  TimescaleReserveClient,
  selectCurrentBestApyReserveByStablecoin,
  timescaleLatestReserveUpdates,
  timescaleReserveUpdates,
} = await import("../timescale-reserve-client.server");
const { STABLECOIN_MINTS } = await import("@loyal/actions/constants");
const { Stablecoin } = await import("@loyal/actions/types");

type ReserveRow = Parameters<
  typeof selectCurrentBestApyReserveByStablecoin
>[0][number];

function row(overrides: Partial<ReserveRow>): ReserveRow {
  return {
    borrowApy: 0,
    changedFields: [],
    diffChanged: false,
    diffSummary: "",
    liquidityMint: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
    market: "market",
    marketName: "Main",
    observedAt: new Date("2026-06-01T00:00:00.000Z"),
    reserve: "reserve-1",
    reserveLastUpdateStale: false,
    slot: 1,
    source: "timescale",
    supplyApy: 0.1,
    symbol: "USDC",
    totalBorrowUsdEstimate: 0,
    totalSupplyUsdEstimate: 1_000_000,
    utilization: 0,
    ...overrides,
  };
}

describe("timescale reserve client", () => {
  test("exposes Kamino Timescale table models", () => {
    expect(timescaleReserveUpdates.reserve.name).toBe("reserve");
    expect(timescaleReserveUpdates.observedAt.name).toBe("observed_at");
    expect(timescaleReserveUpdates.supplyApy.name).toBe("supply_apy");
    expect(timescaleLatestReserveUpdates.slot.name).toBe("slot");
  });

  test("creates a Drizzle-backed client without fetching data", async () => {
    const client = new TimescaleReserveClient({
      databaseUrl: "postgres://localhost/test",
    });

    expect(client.db).toBeDefined();
    expect(client.tables.reserveUpdates).toBe(timescaleReserveUpdates);
    expect(client.tables.latestReserveUpdates).toBe(
      timescaleLatestReserveUpdates
    );

    await client.close();
  });

  test("selects the current highest APY reserve for each supported stablecoin", () => {
    const bestRows = selectCurrentBestApyReserveByStablecoin([
      row({ reserve: "usdc-low", supplyApy: 0.08 }),
      row({
        reserve: "unsupported-mint",
        liquidityMint: "mint",
        supplyApy: 0.5,
      }),
      row({
        liquidityMint: STABLECOIN_MINTS[Stablecoin.USDT].toBase58(),
        reserve: "usdt-best",
        supplyApy: 0.12,
        symbol: "USDT",
      }),
      row({ reserve: "usdc-best", supplyApy: 0.11 }),
    ]);

    expect(
      bestRows.map((bestRow) => [bestRow.stablecoin, bestRow.reserve])
    ).toEqual([
      [Stablecoin.USDC, "usdc-best"],
      [Stablecoin.USDT, "usdt-best"],
    ]);
  });
});
