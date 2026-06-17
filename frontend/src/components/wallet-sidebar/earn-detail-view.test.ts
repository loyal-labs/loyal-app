import { describe, expect, test } from "bun:test";

import type { EarnEarningsResponse } from "@/lib/yield-optimization/earnings.shared";

import {
  deriveEstimatedEarnBalanceAmount,
  deriveEstimatedEarnedSummaryAmount,
  formatEarnedSummaryLabel,
} from "./earn-detail-view";

function createEarningsResponse(
  overrides: Partial<EarnEarningsResponse> = {}
): EarnEarningsResponse {
  return {
    bars: [],
    currentApyBps: 3650,
    lastDepositAt: "2026-06-15T00:00:00.000Z",
    lifetimeEarnedUsd: 10,
    principalAmountRaw: "100000000",
    principalUsd: 100,
    rangeEarnedUsd: 10,
    sinceLastDepositEarnedUsd: 0.5,
    todayEarnedUsd: 0.5,
    ...overrides,
  };
}

describe("Earn active balance display helpers", () => {
  test("big balance uses since-last-deposit earnings instead of lifetime earnings", () => {
    const balance = deriveEstimatedEarnBalanceAmount({
      apyBps: 0,
      earningsData: createEarningsResponse(),
      earningsError: null,
      generatedAt: "2026-06-16T00:00:00.000Z",
      principalAmount: 100,
    });

    expect(balance).toBe(100.5);
  });

  test("green line formats signed dollars only without APY", () => {
    const earned = deriveEstimatedEarnedSummaryAmount({
      apyBps: 0,
      earningsData: createEarningsResponse({
        sinceLastDepositEarnedUsd: 0.003749,
      }),
      earningsError: null,
      generatedAt: "2026-06-16T00:00:00.000Z",
      principalAmount: 100,
    });

    const label = formatEarnedSummaryLabel(earned);

    expect(label).toBe("+$0.003749");
    expect(label).not.toContain("APY");
  });
});
