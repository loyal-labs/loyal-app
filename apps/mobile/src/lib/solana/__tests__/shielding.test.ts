import { computeUnshieldModifyAmount } from "../shielding";

describe("computeUnshieldModifyAmount", () => {
  it("drains the Kamino USDC deposit on MAX instead of stopping at the quoted-share amount", () => {
    // Regression for ASK-1135: 4M raw shares (displayed as "4 USDC")
    // quote to ~3_921_569 shares for 4 USDC liquidity at a 1.02
    // exchange rate. The pre-fix clamp left 78_431 shares behind,
    // rendering as "~0.08 USDC" of residual shielded balance.
    const result = computeUnshieldModifyAmount({
      isMax: true,
      requestedRawAmount: BigInt(4_000_000),
      currentDepositRaw: BigInt(4_000_000),
      isTrackedKaminoToken: true,
      kaminoQuotedShares: BigInt(3_921_569),
    });

    expect(result).toBe(BigInt(4_000_000));
  });

  it("drains the raw SOL deposit on MAX even if the float-converted amount under-counts by a lamport", () => {
    // Balance 0.05 SOL -> Math.floor(0.05 * 1e9) can yield 49_999_999
    // instead of 50_000_000 due to IEEE-754 imprecision, leaving a
    // 1-lamport residue. MAX must burn the actual on-chain deposit.
    const result = computeUnshieldModifyAmount({
      isMax: true,
      requestedRawAmount: BigInt(49_999_999),
      currentDepositRaw: BigInt(50_000_000),
      isTrackedKaminoToken: false,
      kaminoQuotedShares: null,
    });

    expect(result).toBe(BigInt(50_000_000));
  });

  it("uses the Kamino quoted-share amount for partial unshields", () => {
    const result = computeUnshieldModifyAmount({
      isMax: false,
      requestedRawAmount: BigInt(2_000_000),
      currentDepositRaw: BigInt(4_000_000),
      isTrackedKaminoToken: true,
      kaminoQuotedShares: BigInt(1_960_784),
    });

    expect(result).toBe(BigInt(1_960_784));
  });

  it("clamps a Kamino quoted-share amount to the current deposit", () => {
    const result = computeUnshieldModifyAmount({
      isMax: false,
      requestedRawAmount: BigInt(10_000_000),
      currentDepositRaw: BigInt(4_000_000),
      isTrackedKaminoToken: true,
      kaminoQuotedShares: BigInt(9_800_000),
    });

    expect(result).toBe(BigInt(4_000_000));
  });

  it("fails closed for partial Kamino unshields when the quote is unavailable", () => {
    expect(() =>
      computeUnshieldModifyAmount({
        isMax: false,
        requestedRawAmount: BigInt(2_000_000),
        currentDepositRaw: BigInt(4_000_000),
        isTrackedKaminoToken: true,
        kaminoQuotedShares: null,
      })
    ).toThrow("Could not quote the current USDC shielded exchange rate");
  });

  it("uses the raw requested amount for non-Kamino partial unshields", () => {
    const result = computeUnshieldModifyAmount({
      isMax: false,
      requestedRawAmount: BigInt(10_000_000),
      currentDepositRaw: BigInt(50_000_000),
      isTrackedKaminoToken: false,
      kaminoQuotedShares: null,
    });

    expect(result).toBe(BigInt(10_000_000));
  });

  it("fails closed for Kamino MAX unshields when the on-chain deposit is unavailable", () => {
    expect(() =>
      computeUnshieldModifyAmount({
        isMax: true,
        requestedRawAmount: BigInt(1_000_000),
        currentDepositRaw: BigInt(0),
        isTrackedKaminoToken: true,
        kaminoQuotedShares: null,
      })
    ).toThrow("Could not read the current USDC shielded balance");
  });

  it("falls back to the requested raw amount on MAX when the on-chain deposit is empty", () => {
    const result = computeUnshieldModifyAmount({
      isMax: true,
      requestedRawAmount: BigInt(1_000),
      currentDepositRaw: BigInt(0),
      isTrackedKaminoToken: false,
      kaminoQuotedShares: null,
    });

    expect(result).toBe(BigInt(1_000));
  });
});
