import { describe, expect, mock, test } from "bun:test";
import type { EarnEarningsRangeSetResponse } from "./earnings.shared";
import {
  calculateEarnEarnings,
  principalAt,
  sortEarningsEvents,
  type YieldPortfolioSnapshot,
  type YieldPositionEvent,
} from "./earnings-calculator.server";
import type {
  UserYieldPositionHistoryEventRecord,
  UserYieldPositionRecord,
} from "./yield-deposit-repository.server";

mock.module("server-only", () => ({}));
// The exercised read-service exports take their DB dependencies as injected
// arguments; the module-level imports below are stubbed so the pure money and
// coverage logic under test can load without a database client.
mock.module("drizzle-orm", () => ({
  and: (...parts: unknown[]) => ({ kind: "and", parts }),
  eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
}));
mock.module("@/lib/kamino/timescale-reserve-client.server", () => ({
  getTimescaleReserveDatabaseUrl: () => null,
  TimescaleReserveClient: class {},
}));
mock.module("@/lib/yield-optimization/yield-neon-client.server", () => ({
  earnEarningsSnapshots: {},
  getYieldOptimizationClient: () => ({}),
}));
mock.module("@/lib/yield-optimization/yield-deposit-repository.server", () => ({
  findActiveYieldPositionsForVault: async () => [],
  findCompleteYieldVaultExposureSnapshots: async () => [],
  findYieldPositionEvents: async () => [],
  findYieldPositionHistoryEventsForVault: async () => [],
}));

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
  confirmedAt: string,
  metadata: Partial<YieldPositionEvent> = {}
): YieldPositionEvent {
  return {
    amountRaw: BigInt(amountRaw),
    confirmedAt: new Date(confirmedAt),
    liquidityMint,
    type,
    ...metadata,
  };
}

function readMultiMintEarnings(args: {
  ledgerEvents: ReturnType<typeof ledgerEvent>[];
  storedPositions: { initialLiquidityMint: string; principalRaw: number }[];
  onSave?: () => void;
  savedPayload?: EarnEarningsRangeSetResponse;
}) {
  const positions = args.storedPositions.map(
    (stored) =>
      ({
        initialLiquidityMint: stored.initialLiquidityMint,
        principalAmountRaw: BigInt(stored.principalRaw),
      }) as UserYieldPositionRecord
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
    observedAt:
      args.ledgerEvents.find((event) => event.type === "deposit")
        ?.confirmedAt ?? NOW,
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
        ...Array.from({ length: 11 }, (_, index) => ({
          observedAt: new Date(Date.UTC(2026, 7, index + 1)),
          reserve: "reserve-a",
          supplyApy: 0.1,
        })),
        {
          observedAt: new Date("2026-08-11T11:00:00.000Z"),
          reserve: "reserve-a",
          supplyApy: 0.1,
        },
      ],
      loadLedgerEvents: async () => args.ledgerEvents,
      loadPortfolioSnapshots: async () => [portfolioSnapshot],
      loadPositions: async () => positions,
      loadSnapshot: async () =>
        args.savedPayload
          ? {
              generatedAt: new Date(args.savedPayload.generatedAt),
              payload: args.savedPayload,
            }
          : null,
      now: () => NOW,
      saveSnapshot: async () => {
        args.onSave?.();
      },
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

  // Hourly snapshots of a continuously funded reserve are one funded span.
  // Sample age must carry across them: two samples 60 hours apart leave a
  // 60-hour rate hole, which the old per-snapshot sweep hid as 1-hour gaps.
  test("rejects a sample hole inside continuously funded exposure", () => {
    const startMs = Date.parse("2026-08-01T00:00:00.000Z");
    const hourMs = 60 * 60 * 1000;
    const snapshots = Array.from({ length: 61 }, (_, hour) => ({
      exposures: [
        {
          amountRaw: BigInt(100_000_000),
          kind: "kamino" as const,
          liquidityMint: "USDC",
          reserve: "reserve-a",
          sourceId: "reserve:reserve-a",
        },
      ],
      observedAt: new Date(startMs + hour * hourMs),
      observedSlot: BigInt(hour + 1),
    }));

    const coverage = getPortfolioEarningsCoverage({
      apySamples: [
        {
          observedAt: new Date(startMs),
          reserve: "reserve-a",
          supplyApy: 0.1,
        },
        {
          observedAt: new Date(startMs + 60 * hourMs),
          reserve: "reserve-a",
          supplyApy: 0.1,
        },
      ],
      now: new Date(startMs + 60 * hourMs),
      snapshots,
    });

    expect(coverage.gappedReserves).toEqual(["reserve-a"]);
    expect(coverage.maxSampleGapMs).toBe(60 * hourMs);
  });

  test("carries hourly samples across continuously funded snapshots", () => {
    const startMs = Date.parse("2026-08-01T00:00:00.000Z");
    const hourMs = 60 * 60 * 1000;
    const snapshots = Array.from({ length: 61 }, (_, hour) => ({
      exposures: [
        {
          amountRaw: BigInt(100_000_000),
          kind: "kamino" as const,
          liquidityMint: "USDC",
          reserve: "reserve-a",
          sourceId: "reserve:reserve-a",
        },
      ],
      observedAt: new Date(startMs + hour * hourMs),
      observedSlot: BigInt(hour + 1),
    }));

    const coverage = getPortfolioEarningsCoverage({
      apySamples: Array.from({ length: 61 }, (_, hour) => ({
        observedAt: new Date(startMs + hour * hourMs),
        reserve: "reserve-a",
        supplyApy: 0.1,
      })),
      now: new Date(startMs + 60 * hourMs),
      snapshots,
    });

    expect(coverage.gappedReserves).toEqual([]);
    expect(coverage.maxSampleGapMs).toBe(hourMs);
  });

  test("ignores sample holes where the reserve is unfunded", () => {
    const startMs = Date.parse("2026-08-01T00:00:00.000Z");
    const hourMs = 60 * 60 * 1000;
    const fundedSnapshot = (hour: number) => ({
      exposures: [
        {
          amountRaw: BigInt(100_000_000),
          kind: "kamino" as const,
          liquidityMint: "USDC",
          reserve: "reserve-a",
          sourceId: "reserve:reserve-a",
        },
      ],
      observedAt: new Date(startMs + hour * hourMs),
      observedSlot: BigInt(hour + 1),
    });
    const unfundedSnapshot = (hour: number) => ({
      exposures: [
        {
          amountRaw: BigInt(100_000_000),
          kind: "idle" as const,
          liquidityMint: "USDC",
          reserve: null,
          sourceId: "idle:usdc",
        },
      ],
      observedAt: new Date(startMs + hour * hourMs),
      observedSlot: BigInt(hour + 1),
    });

    const coverage = getPortfolioEarningsCoverage({
      apySamples: [
        ...Array.from({ length: 11 }, (_, hour) => ({
          observedAt: new Date(startMs + hour * hourMs),
          reserve: "reserve-a",
          supplyApy: 0.1,
        })),
        {
          observedAt: new Date(startMs + 50 * hourMs),
          reserve: "reserve-a",
          supplyApy: 0.1,
        },
      ],
      now: new Date(startMs + 60 * hourMs),
      snapshots: [
        ...Array.from({ length: 10 }, (_, hour) => fundedSnapshot(hour)),
        ...Array.from({ length: 40 }, (_, hour) => unfundedSnapshot(10 + hour)),
        ...Array.from({ length: 11 }, (_, hour) => fundedSnapshot(50 + hour)),
      ],
    });

    expect(coverage.gappedReserves).toEqual([]);
    // The only measured gaps are inside funded exposure: hourly samples in the
    // first span (1h) and the trailing funded window after the fresh h50
    // resume sample (10h). The 40h unfunded hole itself contributes nothing —
    // if it were measured it would dominate this maximum.
    expect(coverage.maxSampleGapMs).toBe(10 * hourMs);
  });

  test("rejects exposure that resumes after the last sample's lifetime", () => {
    const startMs = Date.parse("2026-08-01T00:00:00.000Z");
    const hourMs = 60 * 60 * 1000;
    const fundedSnapshot = (hour: number) => ({
      exposures: [
        {
          amountRaw: BigInt(100_000_000),
          kind: "kamino" as const,
          liquidityMint: "USDC",
          reserve: "reserve-a",
          sourceId: "reserve:reserve-a",
        },
      ],
      observedAt: new Date(startMs + hour * hourMs),
      observedSlot: BigInt(hour + 1),
    });
    const unfundedSnapshot = (hour: number) => ({
      exposures: [],
      observedAt: new Date(startMs + hour * hourMs),
      observedSlot: BigInt(hour + 1),
    });

    const coverage = getPortfolioEarningsCoverage({
      apySamples: [
        { observedAt: new Date(startMs), reserve: "reserve-a", supplyApy: 0.1 },
      ],
      now: new Date(startMs + 60 * hourMs),
      snapshots: [
        ...Array.from({ length: 10 }, (_, hour) => fundedSnapshot(hour)),
        ...Array.from({ length: 40 }, (_, hour) => unfundedSnapshot(10 + hour)),
        ...Array.from({ length: 11 }, (_, hour) => fundedSnapshot(50 + hour)),
      ],
    });

    expect(coverage.gappedReserves).toEqual(["reserve-a"]);
    expect(coverage.maxSampleGapMs).toBe(60 * hourMs);
  });

  test("funding does not reset the age of a rate observed earlier", () => {
    const hour = 60 * 60 * 1000;
    const start = Date.parse("2026-08-01T00:00:00Z");
    const coverage = getPortfolioEarningsCoverage({
      apySamples: [
        { observedAt: new Date(start), reserve: "reserve-a", supplyApy: 0.1 },
      ],
      now: new Date(start + 40 * hour),
      snapshots: [
        {
          exposures: [
            {
              amountRaw: BigInt(1),
              kind: "kamino",
              liquidityMint: "USDC",
              reserve: "reserve-a",
              sourceId: "reserve:reserve-a",
            },
          ],
          observedAt: new Date(start + 30 * hour),
          observedSlot: BigInt(1),
        },
      ],
    });
    expect(coverage.gappedReserves).toEqual(["reserve-a"]);
    expect(coverage.maxSampleGapMs).toBe(40 * hour);
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

  test("reinitialization discards full-exit rounding dust without erasing prior principal history", async () => {
    const events = [
      ledgerEvent(
        "deposit",
        "USDC",
        1_856_990_000,
        "2026-08-10T10:00:00.000Z",
        { positionId: BigInt(7), initializesPosition: true }
      ),
      ledgerEvent(
        "withdrawal",
        "USDC",
        1_856_989_999,
        "2026-08-10T11:00:00.000Z",
        { positionId: BigInt(7), initializesPosition: false }
      ),
      ledgerEvent("deposit", "USDC", 50_000_000, "2026-08-11T10:00:00.000Z", {
        positionId: BigInt(7),
        initializesPosition: true,
      }),
    ];
    expect(
      principalAt(events, new Date("2026-08-10T10:30:00Z"), "position")
    ).toBe(BigInt(1_856_990_000));
    // Withdrawal amount alone does not prove a lifecycle reset.
    expect(
      principalAt(events, new Date("2026-08-10T12:00:00Z"), "position")
    ).toBe(BigInt(1));
    const result = await readMultiMintEarnings({
      ledgerEvents: events,
      storedPositions: [
        { initialLiquidityMint: "USDC", principalRaw: 50_000_000 },
      ],
    });
    expect(result.freshness).toBe("fresh");
    expect(result.ranges["30D"].principalAmountRaw).toBe("50000000");
  });

  test("same-millisecond exit and reentry follow confirmed slots rather than deposit-first input", async () => {
    const at = "2026-08-11T10:00:00.000Z";
    const events = [
      ledgerEvent("deposit", "USDC", 100_000_000, "2026-08-10T10:00:00.000Z"),
      ledgerEvent("deposit", "USDC", 50_000_000, at, {
        confirmedSlot: BigInt(3),
      }),
      ledgerEvent("withdrawal", "USDC", 105_000_000, at, {
        confirmedSlot: BigInt(2),
      }),
    ];
    const result = await readMultiMintEarnings({
      ledgerEvents: events,
      storedPositions: [
        { initialLiquidityMint: "USDC", principalRaw: 50_000_000 },
      ],
    });
    expect(result.freshness).toBe("fresh");
    expect(result.sourcePrincipalAmountRaw).toBe("50000000");
    expect(sortEarningsEvents(events)[1].type).toBe("withdrawal");
  });

  test("same-slot lifecycle transitions use the shared holding event order", () => {
    const at = "2026-08-11T10:00:00.000Z";
    const events = sortEarningsEvents([
      ledgerEvent("deposit", "USDC", 100, "2026-08-10T10:00:00.000Z", {
        positionId: BigInt(7),
        initializesPosition: true,
      }),
      ledgerEvent("deposit", "USDC", 50, at, {
        confirmedSlot: BigInt(2),
        holdingEventId: BigInt(12),
        positionId: BigInt(7),
        initializesPosition: true,
      }),
      ledgerEvent("withdrawal", "USDC", 105, at, {
        confirmedSlot: BigInt(2),
        holdingEventId: BigInt(11),
        positionId: BigInt(7),
        initializesPosition: false,
      }),
    ]);
    expect(principalAt(events, NOW, "position")).toBe(BigInt(50));
  });

  test("unordered same-time opposing events cannot become fresh or save a snapshot", async () => {
    let saves = 0;
    await expect(
      readMultiMintEarnings({
        ledgerEvents: [
          ledgerEvent("deposit", "USDC", 50, "2026-08-11T10:00:00Z"),
          ledgerEvent("withdrawal", "USDC", 105, "2026-08-11T10:00:00Z"),
        ],
        storedPositions: [{ initialLiquidityMint: "USDC", principalRaw: 0 }],
        onSave: () => {
          saves += 1;
        },
      })
    ).rejects.toThrow("principal_history_order_ambiguous");
    expect(saves).toBe(0);
  });

  test("converged legacy totals cannot certify different historical denominators", async () => {
    let saves = 0;
    const events = [
      ledgerEvent("deposit", "USDC", 100_000_000, "2026-08-10T09:00:00Z"),
      ledgerEvent("deposit", "USDT", 100_000_000, "2026-08-10T10:00:00Z"),
      ledgerEvent("withdrawal", "USDT", 105_000_000, "2026-08-10T11:00:00Z"),
      ledgerEvent("withdrawal", "USDC", 100_000_000, "2026-08-10T12:00:00Z"),
      ledgerEvent("deposit", "USDC", 50_000_000, "2026-08-11T10:00:00Z"),
    ];
    expect(principalAt(events, NOW, "total")).toBe(
      principalAt(events, NOW, "per-mint")
    );
    await expect(
      readMultiMintEarnings({
        ledgerEvents: events,
        storedPositions: [
          { initialLiquidityMint: "USDC", principalRaw: 50_000_000 },
        ],
        onSave: () => {
          saves += 1;
        },
      })
    ).rejects.toMatchObject({ detailCode: "principal_history_ambiguous" });
    expect(saves).toBe(0);
    // Actual position links resolve the same history without selecting a model by its endpoint.
    const linked = events.map((event, index) => ({
      ...event,
      positionId: event.liquidityMint === "USDT" ? BigInt(8) : BigInt(7),
      initializesPosition: index === 0 || index === 1 || index === 4,
    }));
    expect(
      principalAt(linked, new Date("2026-08-10T11:30:00Z"), "position")
    ).toBe(BigInt(100_000_000));
    const result = await readMultiMintEarnings({
      ledgerEvents: linked,
      storedPositions: [
        { initialLiquidityMint: "USDC", principalRaw: 50_000_000 },
      ],
    });
    expect(result.freshness).toBe("fresh");
    const august10 = result.ranges["30D"].bars.find(
      (bar) => bar.startAt === "2026-08-10T00:00:00.000Z"
    );
    // 100 USD for 09-10, 200 for 10-11, 100 for 11-12, then zero.
    expect(august10?.avgPrincipalUsd).toBeCloseTo(400 / 24, 12);
  });

  test("position-backed principal mismatches remain rejected", async () => {
    await expect(
      readMultiMintEarnings({
        ledgerEvents: [
          ledgerEvent("deposit", "USDC", 100, "2026-08-10T10:00:00Z", {
            positionId: BigInt(7),
            initializesPosition: true,
          }),
        ],
        storedPositions: [{ initialLiquidityMint: "USDC", principalRaw: 200 }],
      })
    ).rejects.toMatchObject({ detailCode: "principal_history_mismatch" });
  });

  test("future deposits cannot verify current principal", async () => {
    const result = await readMultiMintEarnings({
      ledgerEvents: [
        ledgerEvent("deposit", "USDC", 100, "2026-08-10T10:00:00Z"),
        ledgerEvent("deposit", "USDC", 50, "2026-08-12T10:00:00Z"),
      ],
      storedPositions: [{ initialLiquidityMint: "USDC", principalRaw: 100 }],
    });
    expect(result.sourcePrincipalAmountRaw).toBe("100");
    expect(result.ranges["30D"].principalAmountRaw).toBe("100");
  });

  test("ambiguous ordering keeps a saved snapshot stale and never overwrites it", async () => {
    const savedPayload = await readMultiMintEarnings({
      ledgerEvents: [
        ledgerEvent("deposit", "USDC", 100, "2026-08-10T10:00:00Z"),
      ],
      storedPositions: [{ initialLiquidityMint: "USDC", principalRaw: 100 }],
    });
    let saves = 0;
    const result = await readMultiMintEarnings({
      savedPayload,
      ledgerEvents: [
        ledgerEvent("deposit", "USDC", 50, "2026-08-11T10:00:00Z"),
        ledgerEvent("withdrawal", "USDC", 105, "2026-08-11T10:00:00Z"),
      ],
      storedPositions: [{ initialLiquidityMint: "USDC", principalRaw: 0 }],
      onSave: () => {
        saves += 1;
      },
    });
    expect(result.freshness).toBe("stale");
    expect(result.staleReason).toBe("history_incomplete");
    expect(result.ranges).toEqual(savedPayload.ranges);
    expect(saves).toBe(0);
  });

  test("partially linked histories and missing lifecycle starts remain unavailable", async () => {
    for (const events of [
      [
        ledgerEvent("deposit", "USDC", 100, "2026-08-10T10:00:00Z", {
          positionId: BigInt(7),
          initializesPosition: true,
        }),
        ledgerEvent("deposit", "USDC", 50, "2026-08-11T10:00:00Z"),
      ],
      [
        ledgerEvent("deposit", "USDC", 150, "2026-08-10T10:00:00Z", {
          positionId: BigInt(7),
          initializesPosition: false,
        }),
      ],
    ]) {
      await expect(
        readMultiMintEarnings({
          ledgerEvents: events,
          storedPositions: [
            { initialLiquidityMint: "USDC", principalRaw: 150 },
          ],
        })
      ).rejects.toMatchObject({ detailCode: "principal_history_ambiguous" });
    }
  });

  test("position links and lifecycle evidence invalidate prior history revisions", () => {
    const event = ledgerEvent("deposit", "USDC", 100, "2026-08-10T10:00:00Z");
    const before = getPortfolioEarningsHistoryRevision({
      events: [event],
      snapshots: [],
    });
    expect(
      getPortfolioEarningsHistoryRevision({
        events: [
          { ...event, positionId: BigInt(7), initializesPosition: true },
        ],
        snapshots: [],
      })
    ).not.toBe(before);
  });

  test("same-time holding snapshots retain the refilled exposure after the exit", () => {
    const at = new Date("2026-08-11T10:00:00Z");
    const holding = (
      type: "deposit" | "withdrawal",
      slot: number,
      amount: number
    ) =>
      ({
        amountRaw: BigInt(amount),
        confirmedAt: at,
        confirmedSlot: BigInt(slot),
        id: BigInt(slot),
        positionId: BigInt(7),
        liquidityMint: "USDC",
        reserve: "reserve-a",
        type,
      }) as UserYieldPositionHistoryEventRecord;
    const snapshots = buildHoldingBackedPortfolioSnapshots({
      completeSnapshots: [],
      holdingEvents: [holding("deposit", 3, 50), holding("withdrawal", 2, 0)],
    });
    expect(snapshots.at(-1)?.exposures[0]?.amountRaw).toBe(BigInt(50));
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
