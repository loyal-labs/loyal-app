import { describe, expect, test } from "bun:test";

import {
  type ActiveEarnPosition,
  type ActiveEarnPositionHolding,
  applyEarnRpcSnapshotToPosition,
  calculateWeightedEarnApyBps,
  isActiveEarnPosition,
} from "./use-active-earn-position";

function holding(
  amountRaw: string,
  kind: "idle" | "kamino",
  supplyApyBps: string | null,
  sourceId: string
): ActiveEarnPositionHolding {
  return {
    amountRaw,
    kind,
    label: sourceId,
    liquidityMint: sourceId,
    market: kind === "kamino" ? sourceId : null,
    marketName: sourceId,
    observedAt: "2026-08-11T00:00:00.000Z",
    observedSlot: "1",
    provenance: {},
    reserve: kind === "kamino" ? sourceId : null,
    sourceId,
    supplyApyBps,
    tokenProgramId: sourceId,
  };
}

describe("multi-source Earn portfolio state", () => {
  test("weights reserve APY by nominal exposure and gives idle a zero rate", () => {
    expect(
      calculateWeightedEarnApyBps([
        holding("100000000", "kamino", "1000", "reserve:a"),
        holding("50000000", "kamino", "2000", "reserve:b"),
        holding("50000000", "idle", null, "idle:c"),
      ])
    ).toBe("1000");
  });

  test("marks APY unavailable when any positive reserve lacks coverage", () => {
    expect(
      calculateWeightedEarnApyBps([
        holding("1", "kamino", "1000", "reserve:a"),
        holding("1", "kamino", null, "reserve:b"),
      ])
    ).toBeNull();
  });

  test("money state follows the holdings vector, not a singular display field", () => {
    const position = {
      currentTotalAmountRaw: "0",
      holdings: [holding("1", "idle", null, "idle:pyusd")],
      status: "active",
    } as ActiveEarnPosition;
    expect(isActiveEarnPosition(position)).toBe(true);
  });

  test("does not rewrite confirmed principal from a live balance change", () => {
    const liveHolding = holding("101000000", "kamino", "1000", "reserve:a");
    const position = {
      currentHolding: {
        amountRaw: "100000000",
        liquidityMint: "USDC",
        market: "market-a",
        observedAt: "2026-08-10T00:00:00.000Z",
        observedSlot: "1",
        provenance: {
          lastHoldingEventId: null,
          lastRebalanceDecisionId: null,
        },
        reserve: "reserve-a",
      },
      currentSupplyApyBps: "1000",
      currentTotalAmountRaw: "100000000",
      display: { label: "USDC", marketName: "Main", mintSymbol: "USDC" },
      initialHolding: {
        liquidityMint: "USDC",
        market: "market-a",
        reserve: "reserve-a",
        supplyApyBps: "1000",
      },
      principalAmountRaw: "100000000",
      status: "active",
    } satisfies ActiveEarnPosition;

    const updated = applyEarnRpcSnapshotToPosition(position, {
      completeness: "complete",
      currentTotalAmountRaw: liveHolding.amountRaw,
      currentTotalNominalUsdMicros: liveHolding.amountRaw,
      holdings: [liveHolding],
      observedAt: liveHolding.observedAt,
      observedSlot: liveHolding.observedSlot,
      provenance: {
        accountCount: 1,
        chunkCount: 1,
        commitment: "confirmed",
        source: "rpc_getMultipleAccounts",
        watchedAccounts: [],
      },
    });

    expect(updated?.principalAmountRaw).toBe("100000000");
    expect(updated?.currentTotalAmountRaw).toBe("101000000");
  });
});
