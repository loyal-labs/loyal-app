import { describe, expect, mock, test } from "bun:test";

import {
  calculateEarnEarnings,
  type YieldPortfolioSnapshot,
} from "./earnings-calculator.server";
import type {
  UserYieldPositionHistoryEventRecord,
  UserYieldPositionRecord,
} from "./yield-deposit-repository.server";

mock.module("server-only", () => ({}));

const {
  buildHoldingBackedPortfolioSnapshots,
  getPortfolioEarningsCoverage,
  getPortfolioEarningsHistoryRevision,
  readEarnEarningsRangeSet,
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

  test("accepts a single position whose principal spans several mints", async () => {
    // The stored position is keyed by its initial mint (USDC) but top-ups in
    // other mints add to the same principal. Here a USDT top-up was withdrawn
    // one raw unit short, so the ledger splits principal as USDC + 1 USDT
    // while the position carries the same total under USDC alone.
    const ledgerEvents = [
      {
        amountRaw: BigInt(1_000_000),
        confirmedAt: new Date("2026-08-10T10:00:00.000Z"),
        liquidityMint: "USDC",
        type: "deposit" as const,
      },
      {
        amountRaw: BigInt(1_856_990_000),
        confirmedAt: new Date("2026-08-10T10:30:00.000Z"),
        liquidityMint: "USDT",
        type: "deposit" as const,
      },
      {
        amountRaw: BigInt(1_856_989_999),
        confirmedAt: new Date("2026-08-10T10:31:00.000Z"),
        liquidityMint: "USDT",
        type: "withdrawal" as const,
      },
    ];
    const position = {
      initialLiquidityMint: "USDC",
      principalAmountRaw: BigInt(1_000_001),
    } as UserYieldPositionRecord;
    const portfolioSnapshot: YieldPortfolioSnapshot = {
      exposures: [
        {
          amountRaw: BigInt(1_000_001),
          kind: "kamino",
          liquidityMint: "USDC",
          reserve: "reserve-a",
          sourceId: "reserve:reserve-a",
        },
      ],
      observedAt: new Date("2026-08-10T10:31:00.000Z"),
      observedSlot: BigInt(3),
    };

    const result = await readEarnEarningsRangeSet(
      {
        cluster: "mainnet",
        settings: "settings",
        timezone: "UTC",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      {
        apyTimeoutMs: 1000,
        loadApySamples: async () => [
          {
            observedAt: new Date("2026-08-10T09:00:00.000Z"),
            reserve: "reserve-a",
            supplyApy: 0.1,
          },
          {
            observedAt: new Date("2026-08-11T11:00:00.000Z"),
            reserve: "reserve-a",
            supplyApy: 0.1,
          },
        ],
        loadLedgerEvents: async () => ledgerEvents,
        loadPortfolioSnapshots: async () => [portfolioSnapshot],
        loadPositions: async () => [position],
        loadSnapshot: async () => null,
        now: () => NOW,
        saveSnapshot: async () => undefined,
      }
    );

    expect(result.freshness).toBe("fresh");
    expect(result.principalMatchesHistory).toBe(true);
    expect(result.ranges["7D"].bars.at(-1)?.label).toBe("Aug 11");
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
