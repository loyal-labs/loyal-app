import { describe, expect, test } from "bun:test";

import {
  aggregateEarnFleetAllocation,
  type EarnFleetVaultState,
} from "./earn-fleet-allocation.shared";

const NOW = new Date("2026-10-02T12:05:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const LIQUIDITY = "kamino_redeemable_liquidity";
const COLLATERAL = "kamino_obligation_collateral_deposited_amount";

function vault(
  overrides: Partial<NonNullable<EarnFleetVaultState["snapshot"]>> & {
    currentIdle?: EarnFleetVaultState["currentIdle"];
  } = {}
): EarnFleetVaultState {
  const { currentIdle, ...snapshot } = overrides;
  return {
    currentIdle: currentIdle ?? [{ amountRaw: "0", observedSlot: "100" }],
    snapshot: {
      contextIdleRaw: null,
      observedAtMs: NOW.getTime() - 5 * 60 * 1000,
      observedSlot: "100",
      positions: [],
      ...snapshot,
    },
    vaultId: "vault",
  };
}

function position(
  reserve: string,
  amountRaw: string,
  amountSemantics: string | null = LIQUIDITY,
  redeemableLiquidityRaw: string | null = null
) {
  return { amountRaw, amountSemantics, redeemableLiquidityRaw, reserve };
}

describe("aggregateEarnFleetAllocation", () => {
  test("sums concurrent reserves and idle capital across vaults", () => {
    const sample = aggregateEarnFleetAllocation(
      [
        vault({
          currentIdle: [
            { amountRaw: "7", observedSlot: "100" },
            { amountRaw: "3", observedSlot: "100" },
          ],
          positions: [position("R1", "100"), position("R2", "50")],
        }),
        vault({ positions: [position("R1", "25")] }),
      ],
      NOW
    );

    expect(sample.reserveAmounts).toEqual({ R1: "125", R2: "50" });
    expect(sample.idleAmountRaw).toBe("10");
    expect(sample.vaultsIncluded).toBe(2);
    expect(sample.excludedAmountRaw).toBe("0");
    expect(sample.observedHour.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  test("counts collateral units only through their recorded conversion", () => {
    const sample = aggregateEarnFleetAllocation(
      [
        vault({ positions: [position("R1", "160", COLLATERAL, "200")] }),
        vault({ positions: [position("R1", "160", COLLATERAL)] }),
        vault({ positions: [position("R1", "40", null)] }),
      ],
      NOW
    );

    expect(sample.reserveAmounts).toEqual({ R1: "200" });
    expect(sample.vaultsIncluded).toBe(1);
    expect(sample.vaultsInvalid).toBe(2);
    expect(sample.excludedAmountRaw).toBe("200");
  });

  test("takes idle from the snapshot context once idle rows have moved on", () => {
    const sample = aggregateEarnFleetAllocation(
      [
        vault({
          contextIdleRaw: "5",
          currentIdle: [{ amountRaw: "9999", observedSlot: "250" }],
          positions: [position("R1", "100")],
        }),
        // No idle evidence for this snapshot at all: its capital is unknown.
        vault({
          currentIdle: [{ amountRaw: "9999", observedSlot: "250" }],
          positions: [position("R1", "60")],
        }),
      ],
      NOW
    );

    expect(sample.reserveAmounts).toEqual({ R1: "100" });
    expect(sample.idleAmountRaw).toBe("5");
    expect(sample.vaultsInvalid).toBe(1);
    expect(sample.excludedAmountRaw).toBe("60");
  });

  test("excludes funded vaults with an old snapshot but keeps emptied ones", () => {
    const old = NOW.getTime() - 6 * HOUR_MS - 1;
    const sample = aggregateEarnFleetAllocation(
      [
        vault({ observedAtMs: old, positions: [position("R2", "300")] }),
        vault({ observedAtMs: NOW.getTime() - 6 * HOUR_MS }),
        vault({ observedAtMs: old }),
        { currentIdle: [], snapshot: null, vaultId: "new" },
      ],
      NOW
    );

    expect(sample.reserveAmounts).toEqual({});
    expect({
      included: sample.vaultsIncluded,
      missing: sample.vaultsMissing,
      stale: sample.vaultsStale,
      total: sample.vaultsTotal,
    }).toEqual({ included: 2, missing: 1, stale: 1, total: 4 });
    expect(sample.excludedAmountRaw).toBe("300");
    expect(sample.oldestSourceAt).toBeNull();
  });
});
