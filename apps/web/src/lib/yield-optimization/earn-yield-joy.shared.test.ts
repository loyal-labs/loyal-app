import { describe, expect, test } from "bun:test";

import {
  earnDigestThresholdUsd,
  selectEarnJoyPush,
  type EarnJoyState,
} from "./earn-yield-joy.shared";

const NOW = new Date("2026-08-16T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function state(overrides: Partial<EarnJoyState> = {}): EarnJoyState {
  return {
    lastPushedAt: daysAgo(1),
    lastPushedEarnedUsd: 0,
    sentCampaigns: [],
    ...overrides,
  };
}

describe("earn joy cadence", () => {
  test("relaxes the bar the longer a wallet has heard nothing", () => {
    expect(earnDigestThresholdUsd(0)).toBe(1);
    expect(earnDigestThresholdUsd(6.9)).toBe(1);
    expect(earnDigestThresholdUsd(7)).toBe(0.1);
    expect(earnDigestThresholdUsd(30)).toBe(0.01);
  });

  test("pays out by position size without any per-user configuration", () => {
    // ~5% APY: $10k earns ~$1.37/day, $1k ~$0.137/day, $10 ~$0.0014/day.
    const digestAfter = (earnedPerDay: number, days: number) =>
      selectEarnJoyPush({
        accountAgeDays: 400,
        lifetimeEarnedUsd: 5 + earnedPerDay * days,
        now: NOW,
        state: state({
          lastPushedAt: daysAgo(days),
          lastPushedEarnedUsd: 5,
          // A wallet past its one-time moments; only the digest is left.
          sentCampaigns: ["yield-first", "yield-six-months", "yield-one-year"],
        }),
      }).kind;

    expect(digestAfter(1.37, 1)).toBe("push"); // $10k: daily
    expect(digestAfter(0.137, 1)).toBe("none"); // $1k: not yet
    expect(digestAfter(0.137, 8)).toBe("push"); // $1k: about weekly
    expect(digestAfter(0.0014, 8)).toBe("none"); // $10: still dust at a week
    expect(digestAfter(0.0014, 31)).toBe("push"); // $10: monthly note
    expect(digestAfter(0.00014, 31)).toBe("none"); // dust: never
  });

  test("adopts an existing wallet silently instead of backdating milestones", () => {
    const decision = selectEarnJoyPush({
      accountAgeDays: 400,
      lifetimeEarnedUsd: 150,
      now: NOW,
      state: null,
    });

    expect(decision).toEqual({
      kind: "seed",
      // $10 is passed but never announced: only the highest milestone counts.
      campaigns: ["yield-first", "yield-total-100", "yield-one-year"],
    });
  });

  test("sends the most meaningful moment first, one per run", () => {
    const decision = selectEarnJoyPush({
      accountAgeDays: 400,
      lifetimeEarnedUsd: 120,
      now: NOW,
      state: state({ lastPushedEarnedUsd: 90, sentCampaigns: ["yield-first"] }),
    });

    expect(decision).toEqual({
      kind: "push",
      push: { amountUsd: 100, campaign: "yield-total-100", type: "milestone" },
    });
  });

  test("never announces an anniversary with nothing to show", () => {
    expect(
      selectEarnJoyPush({
        accountAgeDays: 400,
        lifetimeEarnedUsd: 0.5,
        now: NOW,
        state: state({
          lastPushedEarnedUsd: 0.5,
          sentCampaigns: ["yield-first"],
        }),
      })
    ).toEqual({ kind: "none" });
  });
});
