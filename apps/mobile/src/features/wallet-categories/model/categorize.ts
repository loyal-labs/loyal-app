import {
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "@/lib/solana/constants";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

export type WalletCategory = "stablecoins" | "crypto";

// Stablecoins are split out of the portfolio into their own "Stablecoins"
// bucket; everything else (SOL, LOYAL, …) falls into "Crypto". Matched by
// known mint first, then by symbol so any USD-pegged token the wallet picks up
// — including devnet test mints — lands in the right bucket.
const STABLECOIN_MINTS = new Set<string>([
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDT_MINT_MAINNET,
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PayPal USD (PYUSD)
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", // USDS
]);

const STABLECOIN_SYMBOLS = new Set<string>([
  "USDC",
  "USDT",
  "PYUSD",
  "USDS",
  "DAI",
  "USDD",
  "TUSD",
  "FDUSD",
  "USDG",
  "USDE",
  "USDH",
]);

export function isStablecoinHolding(
  holding: Pick<TokenHolding, "mint" | "symbol">,
): boolean {
  if (STABLECOIN_MINTS.has(holding.mint)) {
    return true;
  }
  const symbol = holding.symbol?.trim().toUpperCase();
  return symbol ? STABLECOIN_SYMBOLS.has(symbol) : false;
}

export function filterHoldingsByCategory(
  holdings: TokenHolding[],
  category: WalletCategory,
): TokenHolding[] {
  return holdings.filter((holding) =>
    category === "stablecoins"
      ? isStablecoinHolding(holding)
      : !isStablecoinHolding(holding),
  );
}

// USD valuation for a holding: prefer the precomputed valueUsd, then derive
// from a spot price. Mirrors the totalPortfolioUsd logic on the wallet screen.
export function holdingUsdValue(holding: TokenHolding): number | null {
  if (typeof holding.valueUsd === "number" && Number.isFinite(holding.valueUsd)) {
    return holding.valueUsd;
  }
  if (
    typeof holding.priceUsd === "number" &&
    Number.isFinite(holding.priceUsd) &&
    holding.priceUsd > 0
  ) {
    return holding.balance * holding.priceUsd;
  }
  return null;
}

export function sumHoldingsUsd(holdings: TokenHolding[]): number {
  let total = 0;
  for (const holding of holdings) {
    total += holdingUsdValue(holding) ?? 0;
  }
  return total;
}
