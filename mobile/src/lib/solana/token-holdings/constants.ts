import { LOYAL_TOKEN_MINT, NATIVE_SOL_MINT } from "../constants";

export const CACHE_TTL_MS = 30_000;

// Last-resort fallbacks when neither the token-detail endpoint nor Helius
// metadata provides a raster logo/symbol. The detail endpoint (CoinGecko)
// does not list LOYAL, so we need this fallback for our own token.
// RN Image cannot render remote SVGs, so every URL here must be PNG/JPG.
export const KNOWN_TOKEN_ICONS: Record<string, string> = {
  [LOYAL_TOKEN_MINT]: "https://avatars.githubusercontent.com/u/210601628?s=200&v=4",
  [NATIVE_SOL_MINT]:
    "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
};

export const KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
  [LOYAL_TOKEN_MINT]: "LOYAL",
  [NATIVE_SOL_MINT]: "SOL",
};

// Mints where we override the token-detail endpoint's label. Native SOL
// balances are rendered under the wrapped-SOL mint address, but CoinGecko
// labels that mint "Wrapped SOL / WSOL" — users should see "Solana / SOL".
export const PINNED_TOKEN_NAMES: Record<string, string> = {
  [NATIVE_SOL_MINT]: "Solana",
};
export const PINNED_TOKEN_SYMBOLS: Record<string, string> = {
  [NATIVE_SOL_MINT]: "SOL",
};

export const DEFAULT_TOKEN_ICON =
  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";
