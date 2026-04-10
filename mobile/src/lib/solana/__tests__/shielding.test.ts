import type { TokenHolding } from "../token-holdings/types";
import {
  buildShieldAssetKey,
  buildShieldAssets,
  getShieldDirection,
  getShieldTokenDecimals,
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
