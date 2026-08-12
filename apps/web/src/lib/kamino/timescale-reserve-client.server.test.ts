import { describe, expect, mock, test } from "bun:test";
import { getTableName } from "drizzle-orm";

mock.module("server-only", () => ({}));

const {
  selectCurrentBestApyReserveByStablecoin,
  selectCurrentEligibleSafeReserves,
  timescaleLatestVerifiedReserveUpdates,
} = await import("./timescale-reserve-client.server");

function reserveRow(overrides: Record<string, unknown> = {}) {
  return {
    borrowApy: 0,
    changedFields: [],
    diffChanged: false,
    diffSummary: "",
    liquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    market: "market",
    marketName: "Main",
    observedAt: new Date("2026-08-12T00:00:00.000Z"),
    reserve: "reserve",
    reserveLastUpdateStale: true,
    slot: 1,
    source: "http_confirmed_refresh",
    supplyApy: 0.03,
    symbol: "USDC",
    totalBorrowUsdEstimate: 0,
    totalSupplyUsdEstimate: 1_000_000,
    utilization: 0,
    ...overrides,
  };
}

describe("verified Earn reserve selection", () => {
  test("uses the verified current-state relation", () => {
    expect(getTableName(timescaleLatestVerifiedReserveUpdates)).toBe(
      "latest_verified_reserve_updates"
    );
  });

  test("does not treat the transaction-refresh stale bit as venue eligibility", () => {
    expect(selectCurrentEligibleSafeReserves([reserveRow()])).toHaveLength(1);
  });

  test("still picks the best APY independently for each mint", () => {
    const selected = selectCurrentBestApyReserveByStablecoin([
      reserveRow({ reserve: "lower", supplyApy: 0.02 }),
      reserveRow({ reserve: "higher", supplyApy: 0.04 }),
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.reserve).toBe("higher");
  });
});
