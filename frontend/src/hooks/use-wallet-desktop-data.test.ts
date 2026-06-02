import { describe, expect, test } from "bun:test";

import {
  createTokenMarketMintsSignature,
  hasDisplayableTokenBalance,
} from "./use-wallet-desktop-data";

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";

describe("createTokenMarketMintsSignature", () => {
  test("includes LOYAL when the portfolio has no valued positions", () => {
    expect(createTokenMarketMintsSignature([])).toBe(LOYL_MINT);
  });

  test("keeps valued position mints and LOYAL unique", () => {
    expect(
      createTokenMarketMintsSignature([
        {
          asset: {
            mint: "So11111111111111111111111111111111111111112",
          },
          totalValueUsd: 10,
        },
        {
          asset: {
            mint: LOYL_MINT,
          },
          totalValueUsd: 1,
        },
        {
          asset: {
            mint: "Dust111111111111111111111111111111111111111",
          },
          totalValueUsd: 0,
        },
      ])
    ).toBe(
      [
        LOYL_MINT,
        "So11111111111111111111111111111111111111112",
      ].join(",")
    );
  });
});

describe("hasDisplayableTokenBalance", () => {
  test("keeps sub-cent shielded SOL balances visible when the token amount displays", () => {
    expect(hasDisplayableTokenBalance(0.0001)).toBe(true);
  });

  test("hides balances that round to zero at token-list precision", () => {
    expect(hasDisplayableTokenBalance(0.000000001)).toBe(false);
  });
});
