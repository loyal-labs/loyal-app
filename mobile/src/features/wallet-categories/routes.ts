import type { Href } from "expo-router";

/** On-screen rectangle of a wallet card, in window coordinates. */
export type CardRect = { x: number; y: number; width: number; height: number };

/** A card rect plus the USD value shown on it — enough to draw the collapsed
 * "card face" while the destination page expands out of it. */
export type CardSourceRect = CardRect & { usd: number };

// Encode the source rect as query params so the category page can morph out of
// (and collapse back into) the card that was tapped. Geometry keeps subpixel
// precision so the final collapsed overlay aligns with the real card underneath;
// the USD value keeps its cents so the morph's card "face" renders identically
// to the real card. Without a rect the page just opens normally.
function withRect(path: string, rect?: CardSourceRect): Href {
  if (!rect) return path as Href;
  const q = [
    `sx=${rect.x.toFixed(3)}`,
    `sy=${rect.y.toFixed(3)}`,
    `sw=${rect.width.toFixed(3)}`,
    `sh=${rect.height.toFixed(3)}`,
    `su=${rect.usd.toFixed(2)}`,
  ].join("&");
  return `${path}?${q}` as Href;
}

export function buildStablecoinsHref(rect?: CardSourceRect): Href {
  return withRect("/wallet/stablecoins", rect);
}

export function buildCryptoHref(rect?: CardSourceRect): Href {
  return withRect("/wallet/crypto", rect);
}

// Earn lives on the home tab (the route group's index).
export function buildEarnHref(): Href {
  return "/(tabs)" as Href;
}

// Solana Week quest tracking (test page), reachable from the wallet "..." menu.
export function buildQuestsHref(): Href {
  return "/wallet/quests" as Href;
}
