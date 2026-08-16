import { describe, expect, mock, test } from "bun:test";

import {
  calculateEarnEarnings,
  type YieldPortfolioSnapshot,
} from "./earnings-calculator.server";
import type { UserYieldPositionHistoryEventRecord } from "./yield-deposit-repository.server";

mock.module("server-only", () => ({}));

const {
  buildHoldingBackedPortfolioSnapshots,
  getPortfolioEarningsCoverage,
  getPortfolioEarningsHistoryRevision,
} = await import("./earnings-read-service.server");

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
  test("keeps earnings from before the first complete portfolio snapshot", () => {
    const depositAt = new Date("2026-08-01T12:00:00.000Z");
    const firstCompleteAt = new Date("2026-08-06T12:00:00.000Z");
    const holdingEvent = {
      amountRaw: BigInt(100_000_000),
      confirmedAt: depositAt,
      confirmedSlot: BigInt(1),
      liquidityMint: "USDC",
      positionId: BigInt(7),
      reserve: "reserve-a",
    } as UserYieldPositionHistoryEventRecord;
    const completeSnapshot: YieldPortfolioSnapshot = {
      exposures: [
        {
          amountRaw: BigInt(100_000_000),
          kind: "kamino",
          liquidityMint: "USDC",
          reserve: "reserve-a",
          sourceId: "reserve:reserve-a",
        },
      ],
      observedAt: firstCompleteAt,
      observedSlot: BigInt(2),
    };
    const portfolioSnapshots = buildHoldingBackedPortfolioSnapshots({
      completeSnapshots: [completeSnapshot],
      holdingEvents: [holdingEvent],
    });
    const result = calculateEarnEarnings({
      apySamples: [
        {
          observedAt: depositAt,
          reserve: "reserve-a",
          supplyApy: 0.365,
        },
      ],
      events: [
        {
          amountRaw: BigInt(100_000_000),
          confirmedAt: depositAt,
          liquidityMint: "USDC",
          type: "deposit",
        },
      ],
      now: new Date("2026-08-11T12:00:00.000Z"),
      portfolioSnapshots,
      range: "30D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBeCloseTo(1, 12);
  });

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
