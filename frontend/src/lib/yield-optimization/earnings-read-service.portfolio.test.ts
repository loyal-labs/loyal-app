import { describe, expect, mock, test } from "bun:test";

import type { YieldPortfolioSnapshot } from "./earnings-calculator.server";

mock.module("server-only", () => ({}));

const { getPortfolioEarningsCoverage, getPortfolioEarningsHistoryRevision } =
  await import("./earnings-read-service.server");

const NOW = new Date("2026-08-11T12:00:00.000Z");

function snapshot(): YieldPortfolioSnapshot {
  return {
    exposures: [
      {
        amountRaw: BigInt(100_000_000),
        kind: "kamino",
        liquidityMint: "USDC",
        reserve: "reserve-a",
        sourceId: "reserve:reserve-a",
      },
      {
        amountRaw: BigInt(50_000_000),
        kind: "kamino",
        liquidityMint: "PYUSD",
        reserve: "reserve-b",
        sourceId: "reserve:reserve-b",
      },
    ],
    observedAt: new Date("2026-08-11T10:00:00.000Z"),
    observedSlot: BigInt(10),
  };
}

describe("portfolio earnings verification", () => {
  test("requires APY coverage for every concurrently positive reserve", () => {
    const coverage = getPortfolioEarningsCoverage({
      apySamples: [
        {
          observedAt: new Date("2026-08-11T09:00:00.000Z"),
          reserve: "reserve-a",
          supplyApy: 0.1,
        },
      ],
      now: NOW,
      snapshots: [snapshot()],
    });

    expect(coverage.missingReserves).toEqual(["reserve-b"]);
    expect(coverage.staleReserves).toEqual(["reserve-b"]);
  });

  test("history revision changes when one source exposure changes", () => {
    const base = snapshot();
    const changed: YieldPortfolioSnapshot = {
      ...base,
      exposures: base.exposures.map((exposure) =>
        exposure.sourceId === "reserve:reserve-b"
          ? { ...exposure, amountRaw: exposure.amountRaw + BigInt(1) }
          : exposure
      ),
    };
    const events = [
      {
        amountRaw: BigInt(100_000_000),
        confirmedAt: new Date("2026-08-11T09:00:00.000Z"),
        liquidityMint: "USDC",
        type: "deposit" as const,
      },
    ];

    expect(
      getPortfolioEarningsHistoryRevision({ events, snapshots: [base] })
    ).not.toBe(
      getPortfolioEarningsHistoryRevision({ events, snapshots: [changed] })
    );
  });
});
