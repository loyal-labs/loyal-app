import { describe, expect, test } from "bun:test";

import type { LoadedEarnAutodepositScheduledSweep } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import type { EarnTransactionItem } from "@/lib/yield-optimization/earn-transactions.client";

import {
  buildEarnTransactionDetail,
  formatEarnTransactionDateGroup,
  formatEarnTransactionTimestamp,
  formatScheduledSweepAmount,
  formatScheduledSweepTime,
  groupEarnTransactions,
  resolveEarnTransactionDisplayTimeZone,
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

function createTransaction(
  overrides: Partial<EarnTransactionItem> = {}
): EarnTransactionItem {
  return {
    amount: "+$1.00",
    confirmedAt: "2026-06-16T00:30:00.000Z",
    confirmedSlot: "123",
    dateGroup: "16 June",
    destination: { icon: null, label: "Earn vault" },
    eventType: "deposit_top_up",
    id: "tx-1",
    kind: "deposit",
    rawAmount: "$1.000000",
    signature: "signature",
    sortTimestamp: "2026-06-16T00:30:00.000Z",
    source: { icon: null, label: "Main USDC" },
    timestamp: "12:30 AM",
    ...overrides,
  };
}

describe("Earn transaction timezone formatting", () => {
  test("formats completed transaction timestamps in a supplied user timezone", () => {
    expect(
      formatEarnTransactionDateGroup(
        "2026-06-16T00:30:00.000Z",
        "America/Los_Angeles"
      )
    ).toBe("June 15");
    expect(
      formatEarnTransactionTimestamp(
        "2026-06-16T00:30:00.000Z",
        "America/Los_Angeles"
      )
    ).toBe("5:30 PM");
  });

  test("groups completed transactions by user-local calendar date", () => {
    const groups = groupEarnTransactions(
      [
        createTransaction({
          confirmedAt: "2026-06-16T00:30:00.000Z",
          dateGroup: "June 16",
          id: "late-utc",
          sortTimestamp: "2026-06-16T00:30:00.000Z",
        }),
        createTransaction({
          confirmedAt: "2026-06-15T23:30:00.000Z",
          dateGroup: "June 15",
          id: "early-utc",
          sortTimestamp: "2026-06-15T23:30:00.000Z",
        }),
      ],
      "America/Los_Angeles"
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.date).toBe("June 15");
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "late-utc",
      "early-utc",
    ]);
  });

  test("falls back to UTC when the timezone is invalid", () => {
    expect(resolveEarnTransactionDisplayTimeZone("Invalid/Timezone")).toBe(
      "UTC"
    );
    expect(
      formatEarnTransactionDateGroup(
        "2026-06-16T00:30:00.000Z",
        "Invalid/Timezone"
      )
    ).toBe("June 16");
    expect(
      formatEarnTransactionTimestamp(
        "2026-06-16T00:30:00.000Z",
        "Invalid/Timezone"
      )
    ).toBe("12:30 AM");
  });

  test("builds transaction details with user-local time labels", () => {
    const detail = buildEarnTransactionDetail(
      createTransaction(),
      "America/Los_Angeles"
    );

    expect(detail.activity.date).toBe("June 15");
    expect(detail.activity.timestamp).toBe("5:30 PM");
  });
});

describe("Earn transactions scheduled sweeps", () => {
  test("formats scheduled sweep amounts from raw USDC", () => {
    expect(formatScheduledSweepAmount("334480000")).toBe("334.48 USDC");
    expect(formatScheduledSweepAmount("1000000")).toBe("1.00 USDC");
    expect(formatScheduledSweepAmount("invalid")).toBe("0.00 USDC");
  });

  test("formats scheduled sweep times without static placeholder copy", () => {
    const label = formatScheduledSweepTime(
      "2026-06-15T18:06:00.000Z",
      "America/Los_Angeles"
    );

    expect(label).toContain("Jun");
    expect(label).toContain("15");
    expect(label).toContain("11:06 AM");
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
