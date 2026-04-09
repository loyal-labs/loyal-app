import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_DECIMALS,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "../constants";
import { resolveTokenIcon } from "./resolve-token-info";
import type { TokenHolding } from "./types";

type PrefillToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
};

const DEFAULT_TOKEN_DECIMALS = 6;

const resolveUsdcMint = (): string => {
  const env = process.env.EXPO_PUBLIC_SOLANA_ENV ?? "devnet";
  return env === "mainnet"
    ? SOLANA_USDC_MINT_MAINNET
    : SOLANA_USDC_MINT_DEVNET;
};

const getPrefillTokens = (): PrefillToken[] => [
  {
    mint: NATIVE_SOL_MINT,
    symbol: "SOL",
    name: "Solana",
    decimals: NATIVE_SOL_DECIMALS,
  },
  {
    mint: LOYAL_TOKEN_MINT,
    symbol: "LOYAL",
    name: "Loyal",
    decimals: DEFAULT_TOKEN_DECIMALS,
  },
  {
    mint: resolveUsdcMint(),
    symbol: "USDC",
    name: "USD Coin",
    decimals: DEFAULT_TOKEN_DECIMALS,
  },
];

const sortByUsdValueDesc = (a: TokenHolding, b: TokenHolding): number =>
  (b.valueUsd ?? 0) - (a.valueUsd ?? 0);

const toZeroHolding = (
  existingHolding: TokenHolding | undefined,
  fallback: PrefillToken,
): TokenHolding => ({
  mint: fallback.mint,
  symbol: fallback.symbol,
  name: fallback.name,
  balance: 0,
  decimals: existingHolding?.decimals ?? fallback.decimals,
  priceUsd: existingHolding?.priceUsd ?? null,
  valueUsd: 0,
  imageUrl:
    existingHolding?.imageUrl ??
    resolveTokenIcon({ mint: fallback.mint, imageUrl: null }),
  isSecured: false,
});

export function getDisplayTokenHoldings(holdings: TokenHolding[]): TokenHolding[] {
  const positiveHoldings = holdings
    .filter((holding) => holding.balance > 0)
    .sort(sortByUsdValueDesc);

  if (positiveHoldings.length > 0) {
    return positiveHoldings;
  }

  return getPrefillTokens().map((token) => {
    const existingHolding = holdings.find(
      (holding) => holding.mint === token.mint && !holding.isSecured,
    ) ?? holdings.find((holding) => holding.mint === token.mint);
    return toZeroHolding(existingHolding, token);
  });
}
