import type { TokenHolding } from "@/lib/solana/token-holdings/types";

import { buildTokenRowContent } from "../tokens-list-row";

const solHolding: TokenHolding = {
  mint: "sol",
  symbol: "SOL",
  name: "Solana",
  balance: 0,
  decimals: 9,
  priceUsd: 85.73,
  valueUsd: 0,
  imageUrl: null,
  isSecured: false,
};

describe("buildTokenRowContent", () => {
  it("formats the requested wallet row layout from loaded market data", () => {
    expect(
      buildTokenRowContent(solHolding, {
        status: "loaded",
        priceUsd: 85.73,
        priceChange24hPercent: 4.06,
      }),
    ).toEqual({
      title: "Solana",
      usdValue: "$0.00",
      balanceWithSymbol: "0 SOL",
      priceText: "$85.73",
      priceChangeText: "+4.06%",
      priceChangeTone: "positive",
      showMarketSkeleton: false,
    });
  });

  it("shows a market skeleton while row market data is loading", () => {
    expect(
      buildTokenRowContent(solHolding, { status: "loading" }),
    ).toMatchObject({
      showMarketSkeleton: true,
      title: "Solana",
      usdValue: "$0.00",
      balanceWithSymbol: "0 SOL",
    });
  });

  it("falls back to holding price without a delta after a market fetch failure", () => {
    expect(
      buildTokenRowContent(
        {
          ...solHolding,
          balance: 1.25,
          valueUsd: 107.1625,
        },
        { status: "error" },
      ),
    ).toEqual({
      title: "Solana",
      usdValue: "$107.16",
      balanceWithSymbol: "1.25 SOL",
      priceText: "$85.73",
      priceChangeText: null,
      priceChangeTone: null,
      showMarketSkeleton: false,
    });
  });
});
