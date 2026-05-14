/**
 * Port of app/src/lib/solana/deposits/__tests__/kamino-usdc-position.test.ts
 * Covers the pure math helpers (aggregation, proportional unshield, current
 * principal resolution) plus the storage round-trip against a mocked
 * expo-secure-store.
 */

import {
  applyKaminoShieldToTrackedPosition,
  applyKaminoUnshieldToTrackedPosition,
  clearKaminoUsdcPosition,
  loadKaminoUsdcTrackedPosition,
  recordKaminoUsdcShield,
  recordKaminoUsdcUnshield,
  resolveKaminoPrincipalLiquidityAmountRaw,
} from "../kamino-usdc-position";

const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const store = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(store.get(key) ?? null),
  ),
  setItemAsync: jest.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  }),
}));

beforeEach(() => store.clear());

describe("kamino-usdc-position math", () => {
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

    const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw(
      {
        trackedPosition,
        actualCollateralSharesAmountRaw: 49_000_000n,
        currentLiquidityAmountRaw: 50_500_000n,
      },
    );

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

    const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw(
      {
        trackedPosition,
        actualCollateralSharesAmountRaw: 147_000_000n,
        currentLiquidityAmountRaw: 151_000_000n,
      },
    );

    expect(principalLiquidityAmountRaw).toBe(150_333_334n);
  });
});

describe("kamino-usdc-position storage", () => {
  const publicKey = "9fSPbH1GX3wfwUdkr3ytxi6qSr7AJeEZ9W27qhRbvMX9";

  test("records a shield and reads it back", async () => {
    await recordKaminoUsdcShield({
      publicKey,
      solanaEnv: "mainnet",
      addedPrincipalLiquidityAmountRaw: 100_000_000n,
      addedCollateralSharesAmountRaw: 98_000_000n,
    });

    const stored = await loadKaminoUsdcTrackedPosition({
      publicKey,
      solanaEnv: "mainnet",
    });

    expect(stored).not.toBeNull();
    expect(stored?.principalLiquidityAmountRaw).toBe("100000000");
    expect(stored?.collateralSharesAmountRaw).toBe("98000000");
    expect(stored?.mint).toBe(MAINNET_USDC_MINT);
  });

  test("scopes storage per public key + env", async () => {
    await recordKaminoUsdcShield({
      publicKey,
      solanaEnv: "mainnet",
      addedPrincipalLiquidityAmountRaw: 100_000_000n,
      addedCollateralSharesAmountRaw: 98_000_000n,
    });

    const sameKeyDevnet = await loadKaminoUsdcTrackedPosition({
      publicKey,
      solanaEnv: "devnet",
    });
    const otherKeyMainnet = await loadKaminoUsdcTrackedPosition({
      publicKey: "9fSPbH1GX3wfwUdkr3ytxi6qSr7AJeEZ9W27qhRbvMXZ",
      solanaEnv: "mainnet",
    });

    expect(sameKeyDevnet).toBeNull();
    expect(otherKeyMainnet).toBeNull();
  });

  test("deletes the record when every share is burned", async () => {
    await recordKaminoUsdcShield({
      publicKey,
      solanaEnv: "mainnet",
      addedPrincipalLiquidityAmountRaw: 100_000_000n,
      addedCollateralSharesAmountRaw: 98_000_000n,
    });

    await recordKaminoUsdcUnshield({
      publicKey,
      solanaEnv: "mainnet",
      burnedCollateralSharesAmountRaw: 98_000_000n,
    });

    const stored = await loadKaminoUsdcTrackedPosition({
      publicKey,
      solanaEnv: "mainnet",
    });
    expect(stored).toBeNull();
  });

  test("clearKaminoUsdcPosition wipes the record", async () => {
    await recordKaminoUsdcShield({
      publicKey,
      solanaEnv: "mainnet",
      addedPrincipalLiquidityAmountRaw: 100_000_000n,
      addedCollateralSharesAmountRaw: 98_000_000n,
    });
    await clearKaminoUsdcPosition({ publicKey, solanaEnv: "mainnet" });
    expect(
      await loadKaminoUsdcTrackedPosition({ publicKey, solanaEnv: "mainnet" }),
    ).toBeNull();
  });

  test("returns null on localnet (no tracked mint)", async () => {
    const result = await recordKaminoUsdcShield({
      publicKey,
      solanaEnv: "localnet",
      addedPrincipalLiquidityAmountRaw: 100_000_000n,
      addedCollateralSharesAmountRaw: 98_000_000n,
    });
    expect(result).toBe(false);
    expect(
      await loadKaminoUsdcTrackedPosition({
        publicKey,
        solanaEnv: "localnet",
      }),
    ).toBeNull();
  });
});
