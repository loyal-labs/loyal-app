import {
  getDisplayTokenHoldings,
  getPairPositions,
} from "../display-holdings";
import type { TokenHolding } from "../types";

const makeHolding = (overrides: Partial<TokenHolding>): TokenHolding => ({
  mint: "mint-x",
  symbol: "X",
  name: "Token X",
  balance: 1,
  decimals: 6,
  priceUsd: 1,
  valueUsd: 1,
  imageUrl: null,
  isSecured: false,
  ...overrides,
});

describe("getDisplayTokenHoldings pair grouping", () => {
  it("keeps regular + shielded variants of the same mint adjacent when a higher-value unrelated holding would split them", () => {
    const usdcRegular = makeHolding({
      mint: "mint-usdc",
      symbol: "USDC",
      valueUsd: 100,
    });
    const sol = makeHolding({
      mint: "mint-sol",
      symbol: "SOL",
      valueUsd: 50,
    });
    const usdcShielded = makeHolding({
      mint: "mint-usdc",
      symbol: "USDC",
      valueUsd: 30,
      isSecured: true,
    });

    const result = getDisplayTokenHoldings([usdcRegular, sol, usdcShielded]);

    expect(result.map((h) => ({ mint: h.mint, isSecured: !!h.isSecured }))).toEqual([
      { mint: "mint-usdc", isSecured: false },
      { mint: "mint-usdc", isSecured: true },
      { mint: "mint-sol", isSecured: false },
    ]);
  });

  it("puts the regular variant before the shielded one even when shielded has higher value", () => {
    const loyalShielded = makeHolding({
      mint: "mint-loyal",
      symbol: "LOYAL",
      valueUsd: 200,
      isSecured: true,
    });
    const loyalRegular = makeHolding({
      mint: "mint-loyal",
      symbol: "LOYAL",
      valueUsd: 40,
    });

    const result = getDisplayTokenHoldings([loyalShielded, loyalRegular]);

    expect(result.map((h) => !!h.isSecured)).toEqual([false, true]);
  });

  it("leaves singletons untouched", () => {
    const sol = makeHolding({ mint: "mint-sol", symbol: "SOL", valueUsd: 50 });
    const bonk = makeHolding({ mint: "mint-bonk", symbol: "BONK", valueUsd: 30 });

    const result = getDisplayTokenHoldings([sol, bonk]);
    expect(result.map((h) => h.mint)).toEqual(["mint-sol", "mint-bonk"]);
  });
});

describe("getPairPositions", () => {
  it("flags consecutive same-mint holdings as top/bottom", () => {
    const holdings: TokenHolding[] = [
      makeHolding({ mint: "mint-usdc" }),
      makeHolding({ mint: "mint-usdc", isSecured: true }),
      makeHolding({ mint: "mint-sol" }),
    ];

    expect(getPairPositions(holdings)).toEqual(["top", "bottom", "single"]);
  });

  it("treats non-adjacent same-mint holdings as singles", () => {
    const holdings: TokenHolding[] = [
      makeHolding({ mint: "mint-usdc" }),
      makeHolding({ mint: "mint-sol" }),
      makeHolding({ mint: "mint-usdc", isSecured: true }),
    ];

    expect(getPairPositions(holdings)).toEqual(["single", "single", "single"]);
  });
});
