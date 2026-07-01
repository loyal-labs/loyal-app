import { describe, expect, test } from "bun:test";

import {
  calculateEarnEarnings,
  type ReserveApySample,
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
});
