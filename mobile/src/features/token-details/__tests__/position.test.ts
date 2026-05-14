import type { TokenHolding } from "@/lib/solana/token-holdings/types";

import { buildTokenPosition } from "../position";

describe("buildTokenPosition", () => {
  it("splits public and shielded balances and combines the total", () => {
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
        mint: "mint-other",
        symbol: "OTHER",
        name: "Other",
        balance: 10,
        decimals: 6,
        priceUsd: 2,
        valueUsd: 20,
        imageUrl: "https://example.com/other.png",
        isSecured: false,
      },
    ];

    expect(buildTokenPosition("mint-sol", holdings)).toEqual({
      mint: "mint-sol",
      publicBalance: 1.25,
      shieldedBalance: 0.4,
      totalBalance: 1.65,
      totalValueUsd: 247.5,
      symbol: "SOL",
      name: "Solana",
      icon: "https://example.com/sol.png",
    });
  });
});
