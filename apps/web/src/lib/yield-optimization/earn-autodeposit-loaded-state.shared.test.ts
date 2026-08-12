import { describe, expect, test } from "bun:test";

import { getDisplayableEarnAutodepositScheduledSweeps } from "./earn-autodeposit-loaded-state.shared";

describe("getDisplayableEarnAutodepositScheduledSweeps", () => {
  test("returns nothing while the config is not active", () => {
    expect(
      getDisplayableEarnAutodepositScheduledSweeps("paused", [
        { id: "1", status: "scheduled" },
      ])
    ).toEqual([]);
  });

  test("passes scheduled sweeps through when nothing is executing", () => {
    const sweeps = [
      { id: "1", status: "scheduled" },
      { id: "2", status: "failed" },
    ];
    expect(
      getDisplayableEarnAutodepositScheduledSweeps("active", sweeps)
    ).toEqual(sweeps);
  });

  test("hides scheduled siblings while a sweep is executing", () => {
    // On claim the worker re-points open lots to the next recurring slot, so
    // a scheduled sibling would show the same funds as the executing sweep.
    for (const executing of ["requested", "selected"]) {
      expect(
        getDisplayableEarnAutodepositScheduledSweeps("created", [
          { id: "1", status: executing },
          { id: "2", status: "scheduled" },
          { id: "3", status: "released" },
        ])
      ).toEqual([
        { id: "1", status: executing },
        { id: "3", status: "released" },
      ]);
    }
  });
});
