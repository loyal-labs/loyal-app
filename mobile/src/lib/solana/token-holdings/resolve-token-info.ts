import { DEFAULT_TOKEN_ICON, KNOWN_TOKEN_ICONS } from "./constants";
import type { TokenHolding } from "./types";

type TokenIconSource = {
  mint: string;
  imageUrl?: string | null;
};

export function resolveTokenIcon(source: TokenIconSource): string {
  const imageUrl = source.imageUrl?.trim();
  return imageUrl || KNOWN_TOKEN_ICONS[source.mint] || DEFAULT_TOKEN_ICON;
}

export function resolveTokenInfo(
  mint: string,
  holdings: TokenHolding[],
): { symbol: string; icon: string } {
  const holding = holdings.find((h) => h.mint === mint);
  const shortenMint = (m: string): string =>
    m.length > 10 ? `${m.slice(0, 4)}...${m.slice(-4)}` : m;
  const symbol = holding?.symbol?.trim() ? holding.symbol : shortenMint(mint);
  const icon = resolveTokenIcon({ mint, imageUrl: holding?.imageUrl });
  return { symbol, icon };
}
