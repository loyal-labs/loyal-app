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

function ledgerEvent(
  type: "deposit" | "withdrawal",
  liquidityMint: string,
  amountRaw: number,
  confirmedAt: string
) {
  return {
    amountRaw: BigInt(amountRaw),
    confirmedAt: new Date(confirmedAt),
    liquidityMint,
    type,
  };
}

function readMultiMintEarnings(args: {
  ledgerEvents: ReturnType<typeof ledgerEvent>[];
  storedPositions: { initialLiquidityMint: string; principalRaw: number }[];
}) {
  const positions = args.storedPositions.map(
    (stored) =>
      ({
        initialLiquidityMint: stored.initialLiquidityMint,
        principalAmountRaw: BigInt(stored.principalRaw),
      } as UserYieldPositionRecord)
  );
  const storedTotalRaw = positions.reduce(
    (sum, position) => sum + position.principalAmountRaw,
    BigInt(0)
  );
  const portfolioSnapshot: YieldPortfolioSnapshot = {
    exposures: [
      {
        amountRaw: storedTotalRaw,
        kind: "kamino",
        liquidityMint: "USDC",
        reserve: "reserve-a",
        sourceId: "reserve:reserve-a",
      },
    ],
    observedAt: args.ledgerEvents.at(-1)?.confirmedAt ?? NOW,
    observedSlot: BigInt(3),
  };

  return readEarnEarningsRangeSet(
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
          observedAt: new Date("2026-07-31T00:00:00.000Z"),
          reserve: "reserve-a",
          supplyApy: 0.1,
        },
        {
          observedAt: new Date("2026-08-11T11:00:00.000Z"),
          reserve: "reserve-a",
          supplyApy: 0.1,
        },
      ],
      loadLedgerEvents: async () => args.ledgerEvents,
      loadPortfolioSnapshots: async () => [portfolioSnapshot],
      loadPositions: async () => positions,
      loadSnapshot: async () => null,
      now: () => NOW,
      saveSnapshot: async () => undefined,
    }
  );
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

  test("accepts a position whose principal spans several mints", async () => {
    // Positions are keyed by their initial mint (USDC), but top-ups in other
    // mints add to the same principal. This USDT top-up was withdrawn one raw
    // unit short, so the ledger holds USDC + 1 raw USDT while the position
    // carries the same total under USDC alone.
    const result = await readMultiMintEarnings({
      ledgerEvents: [
        ledgerEvent("deposit", "USDC", 1_000_000, "2026-08-10T10:00:00.000Z"),
        ledgerEvent(
          "deposit",
          "USDT",
          1_856_990_000,
          "2026-08-10T10:30:00.000Z"
        ),
        ledgerEvent(
          "withdrawal",
          "USDT",
          1_856_989_999,
          "2026-08-10T10:31:00.000Z"
        ),
      ],
      storedPositions: [
        { initialLiquidityMint: "USDC", principalRaw: 1_000_001 },
      ],
    });

    expect(result.freshness).toBe("fresh");
    expect(result.principalMatchesHistory).toBe(true);
    expect(result.sourcePrincipalAmountRaw).toBe("1000001");
  });

  test("accepts a withdrawal that takes more of a mint than was deposited in it", async () => {
    // Withdrawals include earned yield, so emptying the USDT sleeve takes out
    // more USDT than was deposited. The stored principal subtracts that from
    // its single running total; the ledger must do the same rather than
    // clamping USDT at zero on its own.
    const result = await readMultiMintEarnings({
      ledgerEvents: [
        ledgerEvent(
          "deposit",
          "USDC",
          1_000_000_000,
          "2026-08-01T10:00:00.000Z"
        ),
        ledgerEvent(
          "deposit",
          "USDT",
          1_856_990_000,
          "2026-08-01T11:00:00.000Z"
        ),
        ledgerEvent(
          "withdrawal",
          "USDT",
          1_862_500_000,
          "2026-08-10T10:00:00.000Z"
        ),
      ],
      storedPositions: [
        { initialLiquidityMint: "USDC", principalRaw: 994_490_000 },
      ],
    });

    expect(result.freshness).toBe("fresh");
    expect(result.sourcePrincipalAmountRaw).toBe("994490000");
    expect(result.ranges["30D"].principalAmountRaw).toBe("994490000");
  });

  test("accepts separate positions per mint that each clamp their own withdrawals", async () => {
    // A top-up in a mint with no active position of its own opens a second
    // position. Each position clamps its withdrawals at zero, so withdrawing
    // USDT yield past the USDT principal leaves USDC untouched.
    const result = await readMultiMintEarnings({
      ledgerEvents: [
        ledgerEvent("deposit", "USDC", 100_000_000, "2026-08-01T10:00:00.000Z"),
        ledgerEvent("deposit", "USDT", 100_000_000, "2026-08-01T11:00:00.000Z"),
        ledgerEvent(
          "withdrawal",
          "USDT",
          105_000_000,
          "2026-08-10T10:00:00.000Z"
        ),
      ],
      storedPositions: [
        { initialLiquidityMint: "USDC", principalRaw: 100_000_000 },
        { initialLiquidityMint: "USDT", principalRaw: 0 },
      ],
    });

    expect(result.freshness).toBe("fresh");
    expect(result.sourcePrincipalAmountRaw).toBe("100000000");
    expect(result.ranges["30D"].principalAmountRaw).toBe("100000000");
  });

  test("rejects ledger history whose total differs from the stored principal", async () => {
    await expect(
      readMultiMintEarnings({
        ledgerEvents: [
          ledgerEvent("deposit", "USDC", 1_000_000, "2026-08-10T10:00:00.000Z"),
        ],
        storedPositions: [
          { initialLiquidityMint: "USDC", principalRaw: 2_000_000 },
        ],
      })
    ).rejects.toMatchObject({ detailCode: "principal_history_mismatch" });
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
