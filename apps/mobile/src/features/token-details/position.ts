import { resolveTokenInfo } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

import type { TokenPosition } from "./types";

function sumBalances(holdings: TokenHolding[], mint: string): number {
  return holdings.reduce((total, holding) => {
    if (holding.mint !== mint) {
      return total;
    }
    return total + holding.balance;
  }, 0);
}

function sumValueUsd(holdings: TokenHolding[], mint: string): number | null {
  let total = 0;
  let hasValue = false;

  for (const holding of holdings) {
    if (holding.mint !== mint) {
      continue;
    }

    const value =
      typeof holding.valueUsd === "number" && Number.isFinite(holding.valueUsd)
        ? holding.valueUsd
        : typeof holding.priceUsd === "number" && Number.isFinite(holding.priceUsd)
          ? holding.balance * holding.priceUsd
          : null;

    if (value === null) {
      continue;
    }

    hasValue = true;
    total += value;
  }

  return hasValue ? total : null;
}

function resolveName(
  mint: string,
  symbol: string,
  holdings: TokenHolding[],
): string {
  const name = holdings.find((holding) => holding.mint === mint)?.name?.trim();
  return name || symbol;
}

export function buildTokenPosition(
  mint: string,
  holdings: TokenHolding[],
): TokenPosition {
  const { symbol, icon } = resolveTokenInfo(mint, holdings);

  return {
    mint,
    totalBalance: sumBalances(holdings, mint),
    totalValueUsd: sumValueUsd(holdings, mint),
    symbol,
    name: resolveName(mint, symbol, holdings),
    icon,
  };
}
