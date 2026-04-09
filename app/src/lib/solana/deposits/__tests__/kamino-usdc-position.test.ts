import { describe, expect, test } from "bun:test";

import {
  applyKaminoShieldToTrackedPosition,
  applyKaminoUnshieldToTrackedPosition,
  resolveKaminoPrincipalLiquidityAmountRaw,
} from "../kamino-usdc-position";

const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("kamino-usdc-position", () => {
  test("aggregates principal and shares across multiple shields", () => {
    const first = applyKaminoShieldToTrackedPosition({
      trackedPosition: null,
      mint: MAINNET_USDC_MINT,
      addedPrincipalLiquidityAmountRaw: 100_000_000n,
      addedCollateralSharesAmountRaw: 98_000_000n,
    });
    const second = applyKaminoShieldToTrackedPosition({
      trackedPosition: first,
      mint: MAINNET_USDC_MINT,
      addedPrincipalLiquidityAmountRaw: 50_000_000n,
      addedCollateralSharesAmountRaw: 49_500_000n,
    });

    expect(second).not.toBeNull();
    expect(second?.principalLiquidityAmountRaw).toBe("150000000");
    expect(second?.collateralSharesAmountRaw).toBe("147500000");
    expect(second?.averageEntryExchangeRate).toBe("0.983333333333333333");
  });

  test("reduces principal conservatively when shares are unshielded", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "150000000",
      collateralSharesAmountRaw: "147500000",
      averageEntryExchangeRate: "0.983333333333333333",
      updatedAt: 0,
    };

    const next = applyKaminoUnshieldToTrackedPosition({
      trackedPosition,
      burnedCollateralSharesAmountRaw: 49_500_000n,
    });

    expect(next).not.toBeNull();
    expect(next?.principalLiquidityAmountRaw).toBe("99661017");
    expect(next?.collateralSharesAmountRaw).toBe("98000000");
  });

  test("scales principal down when on-chain shares are lower than tracked shares", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "100000000",
      collateralSharesAmountRaw: "98000000",
      averageEntryExchangeRate: "0.98",
      updatedAt: 0,
    };

    const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw({
      trackedPosition,
      actualCollateralSharesAmountRaw: 49_000_000n,
      currentLiquidityAmountRaw: 50_500_000n,
    });

    expect(principalLiquidityAmountRaw).toBe(50_000_000n);
  });

  test("treats unmatched incoming shares as zero-earned principal", () => {
    const trackedPosition = {
      version: 1 as const,
      mint: MAINNET_USDC_MINT,
      principalLiquidityAmountRaw: "100000000",
      collateralSharesAmountRaw: "98000000",
      averageEntryExchangeRate: "0.98",
      updatedAt: 0,
    };

    const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw({
      trackedPosition,
      actualCollateralSharesAmountRaw: 147_000_000n,
      currentLiquidityAmountRaw: 151_000_000n,
    });

    expect(principalLiquidityAmountRaw).toBe(150_333_334n);
  });
});
