import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { earnDepositReconcileShard, selectDepositRecoveryTarget } = await import(
  "./earn-deposit-reconcile.server"
);

function holding(reserve: string, amountRaw: string) {
  return {
    amountRaw,
    kind: "kamino" as const,
    label: "Kamino",
    liquidityMint: "mint",
    market: "market",
    marketName: "Main",
    observedAt: "2026-08-12T00:00:00.000Z",
    observedSlot: "1",
    provenance: {},
    reserve,
    supplyApyBps: null,
  };
}

describe("Earn deposit recovery target", () => {
  test("uses a stable bounded fleet shard without a database cursor", () => {
    const first = earnDepositReconcileShard("settings-address");
    expect(first).toBe(earnDepositReconcileShard("settings-address"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(24);
  });

  test("uses the reserve named by the finalized transaction, not the largest holding", () => {
    const selected = selectDepositRecoveryTarget({
      reserveCandidates: [
        holding("large-current-reserve", "100000000"),
        holding("small-deposit-reserve", "10"),
      ],
      transactionAccounts: new Set(["small-deposit-reserve"]),
    });
    expect(selected?.reserve).toBe("small-deposit-reserve");
  });

  test("fails closed when no reserve or multiple reserves match", () => {
    const candidates = [holding("one", "1"), holding("two", "2")];
    expect(
      selectDepositRecoveryTarget({
        reserveCandidates: candidates,
        transactionAccounts: new Set(),
      })
    ).toBeNull();
    expect(
      selectDepositRecoveryTarget({
        reserveCandidates: candidates,
        transactionAccounts: new Set(["one", "two"]),
      })
    ).toBeNull();
  });
});
