import {
  DEFAULT_TOKEN_ICON,
  KNOWN_TOKEN_ICONS,
  KNOWN_TOKEN_SYMBOLS,
  PINNED_TOKEN_NAMES,
  PINNED_TOKEN_SYMBOLS,
} from "./constants";
import type { TokenHolding } from "./types";

type TokenIconSource = {
  mint: string;
  imageUrl?: string | null;
  // Preferred source: normalized PNG/JPG from /api/mobile/tokens/:mint
  detailLogoUrl?: string | null;
};

// SVG logos (common on raw token-list URIs) can't be rendered by RN <Image>.
function isRasterImage(url: string | null | undefined): url is string {
  if (!url) return false;
  const clean = url.split("?")[0]?.split("#")[0] ?? url;
  return !clean.toLowerCase().endsWith(".svg");
}

export function resolveTokenIcon(source: TokenIconSource): string {
  const detail = source.detailLogoUrl?.trim();
  if (isRasterImage(detail)) return detail;
  const imageUrl = source.imageUrl?.trim();
  if (isRasterImage(imageUrl)) return imageUrl;
  return KNOWN_TOKEN_ICONS[source.mint] || DEFAULT_TOKEN_ICON;
}

type TokenSymbolSource = {
  mint: string;
  detailSymbol?: string | null;
  holdingSymbol?: string | null;
};

function shortenMint(mint: string): string {
  return mint.length > 10 ? `${mint.slice(0, 4)}...${mint.slice(-4)}` : mint;
}

export function resolveTokenSymbol(source: TokenSymbolSource): string {
  const pinned = PINNED_TOKEN_SYMBOLS[source.mint];
  if (pinned) return pinned;
  const detail = source.detailSymbol?.trim();
  if (detail) return detail;
  const holding = source.holdingSymbol?.trim();
  // Ignore Helius's generic "TOKEN" placeholder — it's no better than a fallback.
  if (holding && holding.toUpperCase() !== "TOKEN") return holding;
  const known = KNOWN_TOKEN_SYMBOLS[source.mint];
  if (known) return known;
  return shortenMint(source.mint);
}

type TokenNameSource = {
  mint: string;
  detailName?: string | null;
  holdingName?: string | null;
};

export function resolveTokenName(source: TokenNameSource): string {
  const pinned = PINNED_TOKEN_NAMES[source.mint];
  if (pinned) return pinned;
  const detail = source.detailName?.trim();
  if (detail) return detail;
  const holding = source.holdingName?.trim();
  if (holding) return holding;
  return resolveTokenSymbol({ mint: source.mint });
}

export function resolveTokenInfo(
  mint: string,
  holdings: TokenHolding[]
): { symbol: string; icon: string } {
  const holding = holdings.find((h) => h.mint === mint);
  const symbol = resolveTokenSymbol({
    mint,
    holdingSymbol: holding?.symbol,
  });
  const icon = resolveTokenIcon({ mint, imageUrl: holding?.imageUrl });
  return { symbol, icon };
}
