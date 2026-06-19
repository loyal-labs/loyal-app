import { describe, expect, it } from "bun:test";

import { computeUnshieldModifyAmount } from "../shielding";

describe("computeUnshieldModifyAmount", () => {
  it("drains tracked Kamino USDC Max from the current deposit shares", () => {
    const result = computeUnshieldModifyAmount({
      currentDepositRaw: BigInt(4_000_000),
      isMax: true,
      isTrackedKaminoToken: true,
      kaminoQuotedShares: BigInt(3_921_569),
      requestedRawAmount: BigInt(4_000_000),
    });

    expect(result).toBe(BigInt(4_000_000));
  });

  it("uses quoted Kamino shares for partial unshields", () => {
    const result = computeUnshieldModifyAmount({
      currentDepositRaw: BigInt(4_000_000),
      isMax: false,
      isTrackedKaminoToken: true,
      kaminoQuotedShares: BigInt(1_960_784),
      requestedRawAmount: BigInt(2_000_000),
    });

    expect(result).toBe(BigInt(1_960_784));
  });

  it("fails closed for partial tracked Kamino USDC when quote is unavailable", () => {
    expect(() =>
      computeUnshieldModifyAmount({
        currentDepositRaw: BigInt(4_000_000),
        isMax: false,
        isTrackedKaminoToken: true,
        kaminoQuotedShares: null,
        requestedRawAmount: BigInt(2_000_000),
      })
    ).toThrow("Could not quote the current USDC shielded exchange rate");
  });

  it("keeps non-Kamino partial unshield amounts raw and unchanged", () => {
    const result = computeUnshieldModifyAmount({
      currentDepositRaw: BigInt(0),
      isMax: false,
      isTrackedKaminoToken: false,
      kaminoQuotedShares: null,
      requestedRawAmount: BigInt(10_000_000),
    });

    expect(result).toBe(BigInt(10_000_000));
  });

  it("keeps web non-Kamino Max fallback on the requested raw amount when no deposit is provided", () => {
    const result = computeUnshieldModifyAmount({
      currentDepositRaw: BigInt(0),
      isMax: true,
      isTrackedKaminoToken: false,
      kaminoQuotedShares: null,
      requestedRawAmount: BigInt(10_000_000),
    });

    expect(result).toBe(BigInt(10_000_000));
  });
});
