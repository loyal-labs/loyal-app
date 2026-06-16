import { describe, expect, test } from "bun:test";

import type { LoadedEarnAutodepositScheduledSweep } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";

import {
  formatScheduledSweepAmount,
  formatScheduledSweepTime,
  shouldShowScheduledSweepsSection,
} from "./earn-transactions-pane";

function createSweep(
  overrides: Partial<LoadedEarnAutodepositScheduledSweep> = {}
): LoadedEarnAutodepositScheduledSweep {
  return {
    classification: "simple_inbound",
    confidence: "observed",
    eligibleAfter: "2026-06-15T18:06:00.000Z",
    id: "1",
    originalAmountRaw: "334480000",
    reason: "incoming USDC",
    remainingAmountRaw: "334480000",
    status: "open",
    ...overrides,
  };
}

describe("Earn transactions scheduled sweeps", () => {
  test("formats scheduled sweep amounts from raw USDC", () => {
    expect(formatScheduledSweepAmount("334480000")).toBe("334.48 USDC");
    expect(formatScheduledSweepAmount("1000000")).toBe("1.00 USDC");
    expect(formatScheduledSweepAmount("invalid")).toBe("0.00 USDC");
  });

  test("formats scheduled sweep times without static placeholder copy", () => {
    const label = formatScheduledSweepTime("2026-06-15T18:06:00.000Z");

    expect(label).toContain("Jun");
    expect(label).toContain("15");
    expect(label).not.toBe("Tomorrow at 18:06");
    expect(formatScheduledSweepTime("invalid")).toBe("Scheduled");
  });

  test("only shows the scheduled section when earn-state has sweeps", () => {
    expect(shouldShowScheduledSweepsSection([])).toBe(false);
    expect(shouldShowScheduledSweepsSection([createSweep()])).toBe(true);
    expect(
      shouldShowScheduledSweepsSection([], { amountRaw: "16967897" })
    ).toBe(true);
  });
});
