import { describe, expect, test } from "bun:test";

import {
  applyKaminoShieldToTrackedPosition,
  applyKaminoUnshieldAccounting,
  applyKaminoUnshieldToTrackedPosition,
  resolveKaminoCumulativeEarnedLiquidityAmountRaw,
  resolveKaminoPrincipalLiquidityAmountRaw,
  resolveKaminoTotalEarnedLiquidityAmountRaw,
} from "../kamino-usdc-position";

const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("kamino-usdc-position", () => {
  test("aggregates principal and shares across multiple shields", () => {
    const first = applyKaminoShieldToTrackedPosition({
      trackedPosition: null,
      mint: MAINNET_USDC_MINT,
      addedPrincipalLiquidityAmountRaw: BigInt(100_000_000),
      addedCollateralSharesAmountRaw: BigInt(98_000_000),
    });
    const second = applyKaminoShieldToTrackedPosition({
      trackedPosition: first,
      mint: MAINNET_USDC_MINT,
      addedPrincipalLiquidityAmountRaw: BigInt(50_000_000),
      addedCollateralSharesAmountRaw: BigInt(49_500_000),
    });

    expect(second).not.toBeNull();
    expect(second?.principalLiquidityAmountRaw).toBe("150000000");
    expect(second?.collateralSharesAmountRaw).toBe("147500000");
    expect(second?.cumulativeEarnedLiquidityAmountRaw).toBe("0");
    expect(second?.averageEntryExchangeRate).toBe("0.983333333333333333");
  });

  test("reduces principal conservatively when shares are unshielded", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "150000000",
      collateralSharesAmountRaw: "147500000",
      cumulativeEarnedLiquidityAmountRaw: "0",
      averageEntryExchangeRate: "0.983333333333333333",
      updatedAt: 0,
    };

    const next = applyKaminoUnshieldToTrackedPosition({
      trackedPosition,
      burnedCollateralSharesAmountRaw: BigInt(49_500_000),
    });

    expect(next).not.toBeNull();
    expect(next?.principalLiquidityAmountRaw).toBe("99661017");
    expect(next?.collateralSharesAmountRaw).toBe("98000000");
    expect(next?.cumulativeEarnedLiquidityAmountRaw).toBe("0");
  });

  test("scales principal down when on-chain shares are lower than tracked shares", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "100000000",
      collateralSharesAmountRaw: "98000000",
      cumulativeEarnedLiquidityAmountRaw: "0",
      averageEntryExchangeRate: "0.98",
      updatedAt: 0,
    };

    const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw({
      trackedPosition,
      actualCollateralSharesAmountRaw: BigInt(49_000_000),
      currentLiquidityAmountRaw: BigInt(50_500_000),
    });

    expect(principalLiquidityAmountRaw).toBe(BigInt(50_000_000));
  });

  test("treats unmatched incoming shares as zero-earned principal", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "100000000",
      collateralSharesAmountRaw: "98000000",
      cumulativeEarnedLiquidityAmountRaw: "0",
      averageEntryExchangeRate: "0.98",
      updatedAt: 0,
    };

    const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw({
      trackedPosition,
      actualCollateralSharesAmountRaw: BigInt(147_000_000),
      currentLiquidityAmountRaw: BigInt(151_000_000),
    });

    expect(principalLiquidityAmountRaw).toBe(BigInt(150_333_334));
  });

  test("accumulates realized earned liquidity on unshield for all-time totals", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "100000000",
      collateralSharesAmountRaw: "100000000",
      cumulativeEarnedLiquidityAmountRaw: "0",
      averageEntryExchangeRate: "1",
      updatedAt: 0,
    };

    const result = applyKaminoUnshieldAccounting({
      trackedPosition,
      actualCollateralSharesAmountRawBeforeUnshield: BigInt(100_000_000),
      currentLiquidityAmountRawBeforeUnshield: BigInt(102_000_000),
      burnedCollateralSharesAmountRaw: BigInt(50_000_000),
      redeemedLiquidityAmountRaw: BigInt(51_000_000),
    });

    expect(result.realizedPrincipalLiquidityAmountRaw).toBe(BigInt(50_000_000));
    expect(result.realizedEarnedLiquidityAmountRaw).toBe(BigInt(1_000_000));
    expect(result.nextTrackedPosition?.principalLiquidityAmountRaw).toBe(
      "50000000"
    );
    expect(result.nextTrackedPosition?.collateralSharesAmountRaw).toBe(
      "50000000"
    );
    expect(
      result.nextTrackedPosition?.cumulativeEarnedLiquidityAmountRaw
    ).toBe("1000000");
    expect(
      resolveKaminoTotalEarnedLiquidityAmountRaw({
        trackedPosition: result.nextTrackedPosition ?? null,
        unrealizedEarnedLiquidityAmountRaw: BigInt(1_000_000),
      })
    ).toBe(BigInt(2_000_000));
  });

  test("preserves tracked basis when the burn only consumes unmatched shares", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "100000000",
      collateralSharesAmountRaw: "100000000",
      cumulativeEarnedLiquidityAmountRaw: "2000000",
      averageEntryExchangeRate: "1",
      updatedAt: 0,
    };

    const result = applyKaminoUnshieldAccounting({
      trackedPosition,
      actualCollateralSharesAmountRawBeforeUnshield: BigInt(150_000_000),
      currentLiquidityAmountRawBeforeUnshield: BigInt(150_000_000),
      burnedCollateralSharesAmountRaw: BigInt(25_000_000),
      redeemedLiquidityAmountRaw: BigInt(25_000_000),
    });

    expect(result.realizedPrincipalLiquidityAmountRaw).toBe(BigInt(25_000_000));
    expect(result.realizedEarnedLiquidityAmountRaw).toBe(BigInt(0));
    expect(result.nextTrackedPosition?.principalLiquidityAmountRaw).toBe(
      "100000000"
    );
    expect(result.nextTrackedPosition?.collateralSharesAmountRaw).toBe(
      "100000000"
    );
    expect(resolveKaminoCumulativeEarnedLiquidityAmountRaw(result.nextTrackedPosition)).toBe(
      BigInt(2_000_000)
    );
  });
});
