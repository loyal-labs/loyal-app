import type { PortfolioPosition } from "@loyal-labs/solana-wallet";

import type { SwapToken } from "./types";

type SwapPosition = Pick<
  PortfolioPosition,
  "priceUsd" | "publicBalance" | "totalBalance"
> & {
  asset: Pick<PortfolioPosition["asset"], "imageUrl" | "mint" | "symbol">;
};

export function createSwapTokensFromPositions(
  positions: SwapPosition[],
  options: {
    balance: "public" | "total";
    getTokenIconUrl?: (symbol: string) => string;
  }
): SwapToken[] {
  return positions
    .map((position) => {
      const balance =
        options.balance === "total"
          ? position.totalBalance
          : position.publicBalance;

      return {
        balance,
        icon:
          position.asset.imageUrl ??
          options.getTokenIconUrl?.(position.asset.symbol) ??
          "",
        mint: position.asset.mint,
        price: position.priceUsd ?? 0,
        symbol: position.asset.symbol,
      };
    })
    .filter((token) => token.balance > 0);
}
