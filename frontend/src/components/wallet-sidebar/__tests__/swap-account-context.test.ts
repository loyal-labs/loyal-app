import { describe, expect, test } from "bun:test";

import { createSwapTokensFromPositions } from "../swap-account-context";

describe("createSwapTokensFromPositions", () => {
  test("uses total balances for Stash swap tokens", () => {
    const tokens = createSwapTokensFromPositions(
      [
        {
          asset: {
            imageUrl: "https://example.com/sol.png",
            mint: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
          },
          priceUsd: 150,
          publicBalance: 0,
          totalBalance: 2.5,
        },
      ],
      { balance: "total" }
    );

    expect(tokens).toEqual([
      {
        balance: 2.5,
        icon: "https://example.com/sol.png",
        mint: "So11111111111111111111111111111111111111112",
        price: 150,
        symbol: "SOL",
      },
    ]);
  });
});
