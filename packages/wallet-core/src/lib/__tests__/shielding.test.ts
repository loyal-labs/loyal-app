import { describe, expect, test } from "bun:test";

import {
  computeUnshieldModifyAmount,
  toRoundedTokenRawAmount,
} from "../shielding";

describe("toRoundedTokenRawAmount", () => {
  test("keeps decimal drift from reducing Max by one raw unit", () => {
    expect(toRoundedTokenRawAmount(1.005, 6)).toBe(1_005_000n);
  });
});

describe("computeUnshieldModifyAmount", () => {
  test("burns the live tracked Kamino deposit amount for Max", () => {
    expect(
      computeUnshieldModifyAmount({
        currentDepositRaw: 1_234_567n,
        isMax: true,
        isTrackedKaminoToken: true,
        kaminoQuotedShares: null,
        requestedRawAmount: 1_200_000n,
      })
    ).toBe(1_234_567n);
  });

  test("uses quoted shares for partial tracked Kamino unshield", () => {
    expect(
      computeUnshieldModifyAmount({
        currentDepositRaw: 1_234_567n,
        isMax: false,
        isTrackedKaminoToken: true,
        kaminoQuotedShares: 617_000n,
        requestedRawAmount: 600_000n,
      })
    ).toBe(617_000n);
  });

  test("clamps partial tracked Kamino unshield to the live deposit", () => {
    expect(
      computeUnshieldModifyAmount({
        currentDepositRaw: 1_234_567n,
        isMax: false,
        isTrackedKaminoToken: true,
        kaminoQuotedShares: 1_234_568n,
        requestedRawAmount: 1_200_000n,
      })
    ).toBe(1_234_567n);
  });
});
