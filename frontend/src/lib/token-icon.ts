import { getTokenIconUrl as getFallbackTokenIconUrl } from "@loyal-labs/wallet-core/lib";

const TOKEN_ICON_OVERRIDES: Record<string, string> = {
  SOL: "https://coin-images.coingecko.com/coins/images/21629/large/solana.jpg",
  USDC: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
};

export function getTokenIconUrl(symbol: string): string {
  return TOKEN_ICON_OVERRIDES[symbol.toUpperCase()] ?? getFallbackTokenIconUrl(symbol);
}
