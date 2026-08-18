import { describe, expect, test } from "bun:test";

import type { SafeReserveApyStatusRow } from "@/lib/kamino/timescale-reserve-monitor.shared";

import {
  computeRebalanceEligibilityFloorRaw,
  summarizeRebalanceEligibility,
} from "./earn-vault-rebalance-eligibility";

const DECIMALS = 6;

function reserve(
  reserveAddress: string,
  supplyApyPercent: number | null
): SafeReserveApyStatusRow {
  return {
    average24hApyPercent: supplyApyPercent,
    average7dApyPercent: supplyApyPercent,
    latestObservedAt: "2026-08-18T12:00:00.000Z",
    liquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    market: `market-${reserveAddress}`,
    marketName: `Market ${reserveAddress}`,
    reserve: reserveAddress,
    status: "eligible",
    supplyApyPercent,
    symbol: "USDC",
    totalSupplyUsdEstimate: 1_000_000,
  };
}

describe("computeRebalanceEligibilityFloorRaw", () => {
  test("matches the planner's economic floor at the live Main-to-OnRe spread", () => {
    // Main Market 4.05% vs OnRe 6.49% is a 244 bps edge. Over the planner's
    // 30-day horizon that earns $0.0020055 per dollar, and the gate needs
    // $0.10 net gain on top of the $0.05 fixed safety margin, so the floor is
    // $0.15 / 0.0020055 ~= $74.79.
    const floor = computeRebalanceEligibilityFloorRaw(
      [reserve("main", 4.05), reserve("onre", 6.49)],
      DECIMALS
    );

    expect(floor).not.toBeNull();
    const floorUsd = Number(floor) / 10 ** DECIMALS;
    expect(floorUsd).toBeGreaterThan(74);
    expect(floorUsd).toBeLessThan(75.5);
  });

  test("widens the floor as the spread narrows", () => {
    const wide = computeRebalanceEligibilityFloorRaw(
      [reserve("a", 4), reserve("b", 8)],
      DECIMALS
    );
    const narrow = computeRebalanceEligibilityFloorRaw(
      [reserve("a", 4), reserve("b", 4.5)],
      DECIMALS
    );

    expect(narrow).toBeGreaterThan(wide as bigint);
  });

  test("never drops below the planner's minimum notional", () => {
    // A giant spread would imply a sub-dollar floor, but the planner also
    // refuses anything under $1.00 of notional.
    const floor = computeRebalanceEligibilityFloorRaw(
      [reserve("a", 1), reserve("b", 900)],
      DECIMALS
    );

    expect(Number(floor) / 10 ** DECIMALS).toBeGreaterThanOrEqual(1);
  });

  test("ignores reserves the Safe monitor already rejected", () => {
    // Below-liquidity reserves report 0% APY on mainnet. Counting them would
    // invent a 6.49% edge and collapse the floor far below what the planner
    // could ever act on.
    const withDeadReserve = computeRebalanceEligibilityFloorRaw(
      [
        reserve("main", 4.05),
        reserve("onre", 6.49),
        { ...reserve("dead", 0), status: "below-liquidity" },
      ],
      DECIMALS
    );
    const withoutDeadReserve = computeRebalanceEligibilityFloorRaw(
      [reserve("main", 4.05), reserve("onre", 6.49)],
      DECIMALS
    );

    expect(withDeadReserve).toBe(withoutDeadReserve as bigint);
  });

  test("returns null when the spread cannot be established", () => {
    expect(
      computeRebalanceEligibilityFloorRaw([reserve("a", 4.05)], DECIMALS)
    ).toBeNull();
    expect(
      computeRebalanceEligibilityFloorRaw(
        [reserve("a", null), reserve("b", null)],
        DECIMALS
      )
    ).toBeNull();
    expect(
      computeRebalanceEligibilityFloorRaw(
        [reserve("a", 4.05), reserve("b", 4.05)],
        DECIMALS
      )
    ).toBeNull();
  });
});

describe("summarizeRebalanceEligibility", () => {
  const vaults = [
    { currentDepositRaw: "7010000", rebalanceCount: 0 },
    { currentDepositRaw: "100000", rebalanceCount: 0 },
    { currentDepositRaw: "100000000", rebalanceCount: 12 },
    { currentDepositRaw: "80000000", rebalanceCount: 0 },
    { currentDepositRaw: "500000", rebalanceCount: 3 },
  ];

  test("counts only vaults that clear the floor", () => {
    const summary = summarizeRebalanceEligibility(vaults, BigInt(74_790_000));

    expect(summary.eligibleCount).toBe(2);
    expect(summary.eligibleRebalancedCount).toBe(1);
    expect(summary.ineligibleCount).toBe(3);
  });

  test("keeps every vault eligible when the floor is unknown", () => {
    const summary = summarizeRebalanceEligibility(vaults, null);

    expect(summary.eligibleCount).toBe(vaults.length);
    expect(summary.eligibleRebalancedCount).toBe(2);
    expect(summary.ineligibleCount).toBe(0);
  });

  test("treats a vault exactly on the floor as eligible", () => {
    const summary = summarizeRebalanceEligibility(
      [{ currentDepositRaw: "74790000", rebalanceCount: 1 }],
      BigInt(74_790_000)
    );

    expect(summary.eligibleCount).toBe(1);
  });
});
