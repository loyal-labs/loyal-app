import type { TokenHolding } from "../token-holdings/types";
import {
  buildShieldAssetKey,
  buildShieldAssets,
  computeUnshieldModifyAmount,
  getShieldDirection,
  getShieldTokenDecimals,
  resolveInitialShieldAssetKey,
} from "../shielding";

describe("buildShieldAssets", () => {
  it("keeps public and shielded balances as separate selectable assets", () => {
    const holdings: TokenHolding[] = [
      {
        mint: "mint-sol",
        symbol: "SOL",
        name: "Solana",
        balance: 1.25,
        decimals: 9,
        priceUsd: 150,
        valueUsd: 187.5,
        imageUrl: "https://example.com/sol.png",
        isSecured: false,
      },
      {
        mint: "mint-sol",
        symbol: "SOL",
        name: "Solana",
        balance: 0.4,
        decimals: 9,
        priceUsd: 150,
        valueUsd: 60,
        imageUrl: "https://example.com/sol.png",
        isSecured: true,
      },
      {
        mint: "mint-usdc",
        symbol: "USDC",
        name: "USD Coin",
        balance: 0,
        decimals: 6,
        priceUsd: 1,
        valueUsd: 0,
        imageUrl: "https://example.com/usdc.png",
        isSecured: false,
      },
    ];

    expect(buildShieldAssets(holdings)).toEqual([
      {
        key: buildShieldAssetKey("mint-sol", false),
        mint: "mint-sol",
        symbol: "SOL",
        name: "Solana",
        balance: 1.25,
        decimals: 9,
        imageUrl: "https://example.com/sol.png",
        isSecured: false,
      },
      {
        key: buildShieldAssetKey("mint-sol", true),
        mint: "mint-sol",
        symbol: "SOL",
        name: "Solana",
        balance: 0.4,
        decimals: 9,
        imageUrl: "https://example.com/sol.png",
        isSecured: true,
      },
    ]);
  });
});

describe("getShieldDirection", () => {
  it("uses the selected asset security state to derive the operation", () => {
    expect(getShieldDirection({ isSecured: false })).toBe("shield");
    expect(getShieldDirection({ isSecured: true })).toBe("unshield");
    expect(getShieldDirection(null)).toBe("shield");
  });
});

describe("resolveInitialShieldAssetKey", () => {
  const assets = buildShieldAssets([
    {
      mint: "mint-sol",
      symbol: "SOL",
      name: "Solana",
      balance: 1,
      decimals: 9,
      priceUsd: 150,
      valueUsd: 150,
      imageUrl: null,
      isSecured: false,
    },
    {
      mint: "mint-usdc",
      symbol: "USDC",
      name: "USD Coin",
      balance: 2,
      decimals: 6,
      priceUsd: 1,
      valueUsd: 2,
      imageUrl: null,
      isSecured: false,
    },
    {
      mint: "mint-usdc",
      symbol: "USDC",
      name: "USD Coin",
      balance: 0.5,
      decimals: 6,
      priceUsd: 1,
      valueUsd: 0.5,
      imageUrl: null,
      isSecured: true,
    },
  ]);

  it("selects the public balance when shield is requested", () => {
    expect(
      resolveInitialShieldAssetKey(assets, {
        initialMint: "mint-usdc",
        initialDirection: "shield",
      }),
    ).toBe(buildShieldAssetKey("mint-usdc", false));
  });

  it("selects the shielded balance when unshield is requested", () => {
    expect(
      resolveInitialShieldAssetKey(assets, {
        initialMint: "mint-usdc",
        initialDirection: "unshield",
      }),
    ).toBe(buildShieldAssetKey("mint-usdc", true));
  });

  it("returns null when no balance matches the requested direction", () => {
    expect(
      resolveInitialShieldAssetKey(assets, {
        initialMint: "mint-sol",
        initialDirection: "unshield",
      }),
    ).toBeNull();
  });
});

describe("getShieldTokenDecimals", () => {
  it("prefers explicit holding decimals over symbol fallbacks", () => {
    expect(
      getShieldTokenDecimals({
        tokenSymbol: "TOKEN",
        tokenDecimals: 9,
      }),
    ).toBe(9);
  });

  it("falls back to known symbol decimals when holding decimals are absent", () => {
    expect(
      getShieldTokenDecimals({
        tokenSymbol: "USDC",
      }),
    ).toBe(6);
  });
});

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
