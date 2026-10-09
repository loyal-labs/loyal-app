import { describe, expect, test } from "bun:test";

import { earnAllocationHistoryFromSamples } from "./earn-fleet-allocation.shared";

const NOW = new Date("2026-10-02T12:05:00.000Z");

describe("earnAllocationHistoryFromSamples", () => {
  const sample = {
    excludedAmountRaw: "0",
    idleAmountRaw: "10",
    observedAtMs: NOW.getTime(),
    reserveAmounts: { R1: "300", R2: "0" },
  };

  test("turns a complete sample into fleet weights with idle kept apart", () => {
    const [snapshot] = earnAllocationHistoryFromSamples(
      [sample],
      NOW.getTime()
    ).snapshots;

    expect([...snapshot.weights]).toEqual([["R1", 300]]);
    expect(snapshot.idleAmountRaw).toBe(10);
    expect(snapshot.unsupported).toBe(false);
  });

  test("tolerates excluded capital up to one percent of covered capital", () => {
    // Covered capital is 300 in reserves plus 10 idle.
    const history = earnAllocationHistoryFromSamples(
      [
        { ...sample, excludedAmountRaw: "3" },
        { ...sample, excludedAmountRaw: "4" },
        {
          ...sample,
          excludedAmountRaw: "1",
          idleAmountRaw: "0",
          reserveAmounts: {},
        },
      ],
      NOW.getTime()
    );

    expect(history.snapshots.map((snapshot) => snapshot.unsupported)).toEqual([
      false,
      true,
      true,
    ]);
  });

  test("marks samples with unreadable amounts unsupported", () => {
    const history = earnAllocationHistoryFromSamples(
      [
        { ...sample, reserveAmounts: { R1: "9007199254740993" } },
        { ...sample, idleAmountRaw: "1.5" },
        { ...sample, excludedAmountRaw: "-1" },
      ],
      NOW.getTime()
    );

    expect(history.snapshots.map((snapshot) => snapshot.unsupported)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
