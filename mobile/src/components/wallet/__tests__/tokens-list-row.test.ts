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

  it("derives the position value from market price when the holding price is missing", () => {
    // USDT: Helius/Jupiter left the holding unpriced (priceUsd/valueUsd null),
    // but the CoinGecko market price loaded — the row must show a real value,
    // not "—".
    expect(
      buildTokenRowContent(
        {
          mint: "usdt",
          symbol: "USDT",
          name: "Tether USD",
          balance: 10,
          decimals: 6,
          priceUsd: null,
          valueUsd: null,
          imageUrl: null,
          isSecured: false,
        },
        {
          status: "loaded",
          priceUsd: 1.0002,
          priceChange24hPercent: 0.02,
        },
      ),
    ).toMatchObject({
      usdValue: "$10.00",
      showMarketSkeleton: false,
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
