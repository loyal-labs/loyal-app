import { describe, expect, test } from "bun:test";

const {
  calculateEarnEarnings,
  createEarningsBuckets,
  normalizeEarningsTimezone,
} = await import("../earnings-calculator.server");

const USDC = BigInt(1_000_000);

function deposit(confirmedAt: string, usdc: number) {
  return {
    amountRaw: BigInt(usdc) * USDC,
    confirmedAt: new Date(confirmedAt),
    type: "deposit" as const,
  };
}

function withdrawal(confirmedAt: string, usdc: number) {
  return {
    amountRaw: BigInt(usdc) * USDC,
    confirmedAt: new Date(confirmedAt),
    type: "withdrawal" as const,
  };
}

function apy(observedAt: string, supplyApy: number) {
  return {
    observedAt: new Date(observedAt),
    supplyApy,
  };
}

describe("earnings calculator", () => {
  test("starts earning after a first deposit in the middle of a bucket", () => {
    const result = calculateEarnEarnings({
      apySamples: [apy("2026-06-01T00:00:00.000Z", 0.1)],
      events: [deposit("2026-06-01T12:00:00.000Z", 100)],
      now: new Date("2026-06-02T00:00:00.000Z"),
      range: "7D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBeCloseTo(100 * 0.1 * 0.5 / 365, 10);
    expect(result.bars.at(-2)?.earnedUsd).toBeCloseTo(
      100 * 0.1 * 0.5 / 365,
      10
    );
  });

  test("accounts for top-up deposits", () => {
    const result = calculateEarnEarnings({
      apySamples: [apy("2026-06-01T00:00:00.000Z", 0.1)],
      events: [
        deposit("2026-06-01T00:00:00.000Z", 100),
        deposit("2026-06-01T12:00:00.000Z", 100),
      ],
      now: new Date("2026-06-02T00:00:00.000Z"),
      range: "7D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBeCloseTo(150 * 0.1 / 365, 10);
    expect(result.principalUsd).toBe(200);
  });

  test("accounts for partial withdrawals", () => {
    const result = calculateEarnEarnings({
      apySamples: [apy("2026-06-01T00:00:00.000Z", 0.1)],
      events: [
        deposit("2026-06-01T00:00:00.000Z", 100),
        withdrawal("2026-06-01T12:00:00.000Z", 40),
      ],
      now: new Date("2026-06-02T00:00:00.000Z"),
      range: "7D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBeCloseTo(80 * 0.1 / 365, 10);
    expect(result.principalUsd).toBe(60);
  });

  test("clamps principal to zero after a full withdrawal", () => {
    const result = calculateEarnEarnings({
      apySamples: [apy("2026-06-01T00:00:00.000Z", 0.1)],
      events: [
        deposit("2026-06-01T00:00:00.000Z", 100),
        withdrawal("2026-06-01T12:00:00.000Z", 200),
      ],
      now: new Date("2026-06-02T00:00:00.000Z"),
      range: "7D",
      timezone: "UTC",
    });

    expect(result.principalAmountRaw).toBe("0");
    expect(result.principalUsd).toBe(0);
    expect(result.lifetimeEarnedUsd).toBeCloseTo(50 * 0.1 / 365, 10);
  });

  test("returns zero earnings with no principal", () => {
    const result = calculateEarnEarnings({
      apySamples: [apy("2026-06-01T00:00:00.000Z", 0.1)],
      events: [],
      now: new Date("2026-06-02T00:00:00.000Z"),
      range: "30D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBe(0);
    expect(result.rangeEarnedUsd).toBe(0);
    expect(result.bars).toHaveLength(30);
    expect(result.bars.every((bar) => bar.apyBps === null)).toBe(true);
  });

  test("returns zero earnings when APY samples are missing", () => {
    const result = calculateEarnEarnings({
      apySamples: [],
      events: [deposit("2026-06-01T00:00:00.000Z", 100)],
      now: new Date("2026-06-02T00:00:00.000Z"),
      range: "7D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBe(0);
    expect(result.currentApyBps).toBeNull();
  });

  test("intersects APY changes inside a bucket", () => {
    const result = calculateEarnEarnings({
      apySamples: [
        apy("2026-06-01T00:00:00.000Z", 0.1),
        apy("2026-06-01T12:00:00.000Z", 0.2),
      ],
      events: [deposit("2026-06-01T00:00:00.000Z", 100)],
      now: new Date("2026-06-02T00:00:00.000Z"),
      range: "7D",
      timezone: "UTC",
    });

    expect(result.lifetimeEarnedUsd).toBeCloseTo(100 * 0.15 / 365, 10);
    expect(result.bars.at(-2)?.apyBps).toBe(1500);
  });

  test("marks the current incomplete bucket", () => {
    const result = calculateEarnEarnings({
      apySamples: [apy("2026-06-01T00:00:00.000Z", 0.1)],
      events: [deposit("2026-06-01T00:00:00.000Z", 100)],
      now: new Date("2026-06-02T12:00:00.000Z"),
      range: "7D",
      timezone: "UTC",
    });

    expect(result.bars.filter((bar) => bar.isCurrent)).toHaveLength(1);
    expect(result.bars.at(-1)?.isCurrent).toBe(true);
  });

  test("uses browser-local day boundaries", () => {
    const buckets = createEarningsBuckets({
      firstDepositAt: new Date("2026-06-01T00:00:00.000Z"),
      now: new Date("2026-06-02T10:00:00.000Z"),
      range: "7D",
      timezone: "America/Los_Angeles",
    });

    expect(buckets.at(-1)?.startAt.toISOString()).toBe(
      "2026-06-02T07:00:00.000Z"
    );
  });

  test("handles a DST transition in local day buckets", () => {
    const buckets = createEarningsBuckets({
      firstDepositAt: new Date("2026-03-07T00:00:00.000Z"),
      now: new Date("2026-03-09T12:00:00.000Z"),
      range: "7D",
      timezone: "America/Los_Angeles",
    });
    const march8 = buckets.find(
      (bucket) => bucket.startAt.toISOString() === "2026-03-08T08:00:00.000Z"
    );

    expect(march8?.endAt.toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });

  test("falls back to UTC for invalid timezone input", () => {
    expect(normalizeEarningsTimezone("not-a-zone")).toBe("UTC");
  });
});
