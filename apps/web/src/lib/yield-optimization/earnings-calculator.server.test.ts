import { describe, expect, test } from "bun:test";

import {
  calculateEarnEarnings,
  principalAt,
  type ReserveApySample,
  type YieldPortfolioSnapshot,
  type YieldPositionEvent,
  type YieldPositionPathEvent,
} from "./earnings-calculator.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-16T00:00:00.000Z");
const APY = 0.365;
const APY_SAMPLES: ReserveApySample[] = [
  {
    observedAt: new Date(NOW.getTime() - 30 * DAY_MS),
    supplyApy: APY,
  },
];

function rawUsdc(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function calculate(events: YieldPositionEvent[]) {
  return calculateEarnEarnings({
    apySamples: APY_SAMPLES,
    events,
    now: NOW,
    range: "30D",
    timezone: "UTC",
  });
}

function calculatePath(args: {
  apySamples: ReserveApySample[];
  pathEvents: YieldPositionPathEvent[];
}) {
  return calculateEarnEarnings({
    apySamples: args.apySamples,
    events: [],
    now: NOW,
    pathEvents: args.pathEvents,
    range: "30D",
    timezone: "UTC",
  });
}

describe("calculateEarnEarnings since latest deposit", () => {
  test("matches lifetime earnings for a first deposit only", () => {
    const result = calculate([
      {
        amountRaw: rawUsdc(100),
        confirmedAt: daysAgo(10),
        type: "deposit",
      },
    ]);

    expect(result.lastDepositAt).toBe(daysAgo(10).toISOString());
    expect(result.sinceLastDepositEarnedUsd).toBeCloseTo(
      result.lifetimeEarnedUsd,
      12
    );
    expect(result.sinceLastDepositEarnedUsd).toBeCloseTo(1, 12);
  });

  test("resets earnings after the latest top-up deposit", () => {
    const result = calculate([
      {
        amountRaw: rawUsdc(100),
        confirmedAt: daysAgo(10),
        type: "deposit",
      },
      {
        amountRaw: rawUsdc(50),
        confirmedAt: daysAgo(2),
        type: "deposit",
      },
    ]);

    expect(result.lastDepositAt).toBe(daysAgo(2).toISOString());
    expect(result.lifetimeEarnedUsd).toBeCloseTo(1.1, 12);
    expect(result.sinceLastDepositEarnedUsd).toBeCloseTo(0.3, 12);
  });

  test("uses reduced principal after a withdrawal following the latest deposit", () => {
    const result = calculate([
      {
        amountRaw: rawUsdc(100),
        confirmedAt: daysAgo(10),
        type: "deposit",
      },
      {
        amountRaw: rawUsdc(50),
        confirmedAt: daysAgo(2),
        type: "deposit",
      },
      {
        amountRaw: rawUsdc(90),
        confirmedAt: daysAgo(1),
        type: "withdrawal",
      },
    ]);

    expect(result.lastDepositAt).toBe(daysAgo(2).toISOString());
    expect(result.principalUsd).toBe(60);
    expect(result.sinceLastDepositEarnedUsd).toBeCloseTo(0.21, 12);
  });

  test("returns zero and no last deposit when no active deposit events exist", () => {
    const result = calculate([]);

    expect(result.lastDepositAt).toBeNull();
    expect(result.sinceLastDepositEarnedUsd).toBe(0);
    expect(result.lifetimeEarnedUsd).toBe(0);
    expect(result.principalUsd).toBe(0);
  });
});

describe("calculateEarnEarnings money path", () => {
  test("uses the reserve APY active for each path interval", () => {
    const result = calculatePath({
      apySamples: [
        {
          observedAt: daysAgo(30),
          reserve: "reserve-a",
          supplyApy: 0.365,
        },
        {
          observedAt: daysAgo(30),
          reserve: "reserve-b",
          supplyApy: 0.73,
        },
      ],
      pathEvents: [
        {
          amountRaw: rawUsdc(100),
          confirmedAt: daysAgo(10),
          liquidityMint: "USDC",
          market: "market-a",
          principalAmountRaw: rawUsdc(100),
          reserve: "reserve-a",
          type: "deposit",
        },
        {
          amountRaw: rawUsdc(100),
          confirmedAt: daysAgo(5),
          liquidityMint: "USDC",
          market: "market-b",
          principalAmountRaw: rawUsdc(100),
          reserve: "reserve-b",
          type: "rebalance",
        },
      ],
    });

    expect(result.lifetimeEarnedUsd).toBeCloseTo(1.5, 12);
    expect(result.currentApyBps).toBe(7300);
  });

  test("aggregates concurrent reserve sources while keeping principal by mint", () => {
    const snapshots: YieldPortfolioSnapshot[] = [
      {
        exposures: [
          {
            amountRaw: rawUsdc(100),
            kind: "kamino",
            liquidityMint: "USDC",
            reserve: "reserve-a",
            sourceId: "reserve:reserve-a",
          },
          {
            amountRaw: rawUsdc(50),
            kind: "kamino",
            liquidityMint: "PYUSD",
            reserve: "reserve-b",
            sourceId: "reserve:reserve-b",
          },
          {
            amountRaw: rawUsdc(50),
            kind: "idle",
            liquidityMint: "USDC",
            reserve: null,
            sourceId: "idle:usdc",
          },
        ],
        observedAt: daysAgo(10),
        observedSlot: BigInt(1),
      },
    ];
    const result = calculateEarnEarnings({
      apySamples: [
        { observedAt: daysAgo(30), reserve: "reserve-a", supplyApy: 0.365 },
        { observedAt: daysAgo(30), reserve: "reserve-b", supplyApy: 0.73 },
      ],
      events: [
        {
          amountRaw: rawUsdc(100),
          confirmedAt: daysAgo(10),
          liquidityMint: "USDC",
          type: "deposit",
        },
        {
          amountRaw: rawUsdc(50),
          confirmedAt: daysAgo(10),
          liquidityMint: "PYUSD",
          type: "deposit",
        },
        {
          amountRaw: rawUsdc(25),
          confirmedAt: daysAgo(1),
          liquidityMint: "PYUSD",
          type: "withdrawal",
        },
      ],
      now: NOW,
      portfolioSnapshots: snapshots,
      range: "30D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBeCloseTo(2, 12);
    expect(result.principalUsd).toBe(125);
    expect(result.currentApyBps).toBe(3650);
    const principal = principalAt(
      [
        {
          amountRaw: rawUsdc(100),
          confirmedAt: daysAgo(10),
          liquidityMint: "USDC",
          type: "deposit",
        },
        {
          amountRaw: rawUsdc(50),
          confirmedAt: daysAgo(10),
          liquidityMint: "PYUSD",
          type: "deposit",
        },
        {
          amountRaw: rawUsdc(25),
          confirmedAt: daysAgo(1),
          liquidityMint: "PYUSD",
          type: "withdrawal",
        },
      ],
      NOW
    );
    expect(principal).toBe(rawUsdc(125));
  });
});

test("checkpoint replay matches full history across deposits, closures, rebalances and calendar boundaries", () => {
  const start = Date.parse("2025-12-20T10:23:00Z");
  const at = (days: number) => new Date(start + days * DAY_MS);
  const events: YieldPositionEvent[] = [
    {
      type: "deposit",
      amountRaw: rawUsdc(1000),
      confirmedAt: at(0),
      positionId: BigInt(1),
      initializesPosition: true,
    },
    {
      type: "deposit",
      amountRaw: rawUsdc(300),
      confirmedAt: at(12.25),
      positionId: BigInt(1),
      initializesPosition: false,
      liquidityMint: "PYUSD",
    },
    {
      type: "withdrawal",
      amountRaw: rawUsdc(100),
      confirmedAt: at(30.5),
      positionId: BigInt(1),
      initializesPosition: false,
    },
    {
      type: "withdrawal",
      amountRaw: rawUsdc(1210),
      confirmedAt: at(40),
      positionId: BigInt(1),
      initializesPosition: false,
      settlesPosition: true,
    },
    {
      type: "deposit",
      amountRaw: rawUsdc(500),
      confirmedAt: at(41),
      positionId: BigInt(1),
      initializesPosition: true,
    },
  ];
  const snapshots: YieldPortfolioSnapshot[] = Array.from(
    { length: 100 },
    (_, day) => ({
      observedAt: at(day),
      observedSlot: BigInt(day),
      exposures: [
        {
          amountRaw: rawUsdc(day === 40 ? 0 : 1000 + day),
          kind: "kamino",
          liquidityMint: day % 2 ? "PYUSD" : "USDC",
          reserve: day % 2 ? "reserve-b" : "reserve-a",
          sourceId: "reserve",
        },
        {
          amountRaw: rawUsdc(50),
          kind: "idle",
          liquidityMint: "USDC",
          reserve: null,
          sourceId: "idle",
        },
      ],
    })
  );
  const apySamples: ReserveApySample[] = Array.from({ length: 100 }, (_, day) =>
    ["reserve-a", "reserve-b"].map((reserve) => ({
      observedAt: at(day),
      reserve,
      supplyApy: 0.05 + day / 10000,
    }))
  ).flat();
  const rounded = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (_key, item) =>
        typeof item === "number" ? Number(item.toFixed(8)) : item
      )
    );
  for (const timezone of ["UTC", "Asia/Tbilisi", "America/New_York"]) {
    for (const range of ["7D", "30D", "1Y", "ALL"] as const) {
      let checkpoint:
        | { at: Date; response: ReturnType<typeof calculateEarnEarnings> }
        | undefined;
      for (const day of [10, 12.5, 31, 40, 41, 42, 78.75, 90.5]) {
        const args = {
          events,
          apySamples,
          now: at(day),
          portfolioSnapshots: snapshots,
          principalClamp: "position" as const,
          range,
          timezone,
        };
        const full = calculateEarnEarnings(args);
        const seed =
          checkpoint &&
          snapshots
            .filter((snapshot) => snapshot.observedAt <= checkpoint!.at)
            .at(-1);
        const tail = checkpoint
          ? [
              ...(seed ? [{ ...seed, observedAt: checkpoint.at }] : []),
              ...snapshots.filter(
                (snapshot) => snapshot.observedAt > checkpoint!.at
              ),
            ]
          : snapshots;
        const incremental = calculateEarnEarnings({
          ...args,
          portfolioSnapshots: tail,
          checkpoint,
        });
        expect(rounded(incremental)).toEqual(rounded(full));
        checkpoint = { at: at(day), response: incremental };
      }
    }
  }
});
