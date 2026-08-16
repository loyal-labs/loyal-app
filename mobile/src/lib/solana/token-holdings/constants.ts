import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "../constants";

export const CACHE_TTL_MS = 30_000;

// Instant-render fallbacks for mints whose icon must render before the
// CoinGecko-backed `/api/mobile/tokens/:mint` endpoint responds.
// CoinGecko is the authoritative source (wired via `useTokenDetails` →
// `detailLogoUrl` in `resolveTokenIcon`) — this map only seeds the PNGs
// shown in the first paint and covers the edge cases CoinGecko can't:
//   * LOYAL — not listed on CoinGecko, so there's no detailLogoUrl ever.
//   * USDC devnet — CoinGecko only serves mainnet mints.
// The mainnet SOL/USDC/USDT entries point at CoinGecko's own CDN so the
// URLs stay consistent with the authoritative source (ASK-1133).
export const KNOWN_TOKEN_ICONS: Record<string, string> = {
  [LOYAL_TOKEN_MINT]:
    "https://avatars.githubusercontent.com/u/210601628?s=200&v=4",
  [NATIVE_SOL_MINT]:
    "https://assets.coingecko.com/coins/images/4128/standard/solana.png",
  [SOLANA_USDC_MINT_MAINNET]:
    "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
  [SOLANA_USDC_MINT_DEVNET]:
    "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
  [SOLANA_USDT_MINT_MAINNET]:
    "https://assets.coingecko.com/coins/images/325/standard/Tether.png",
  // Earn product stablecoins (mint literals; canonical PublicKeys live in
  // @loyal-labs/actions). Art pinned to match the web catalog's icon
  // overrides — CASH isn't listed on CoinGecko, and the issuer art for
  // USDG/PYUSD is the canonical current mark (ASK-1355).
  // CASH
  CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH:
    "https://token-metadata.bridge.xyz/images/cash.png",
  // USDG
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH":
    "https://424565.fs1.hubspotusercontent-na1.net/hubfs/424565/GDN-USDG-Token-512x512.png",
  // PYUSD
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo":
    "https://424565.fs1.hubspotusercontent-na1.net/hubfs/424565/PYUSDLOGO.png",
  // USDS
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA:
    "https://coin-images.coingecko.com/coins/images/39926/large/usds.webp",
};

export const KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
  [LOYAL_TOKEN_MINT]: "LOYAL",
  [NATIVE_SOL_MINT]: "SOL",
  [SOLANA_USDC_MINT_MAINNET]: "USDC",
  [SOLANA_USDC_MINT_DEVNET]: "USDC",
  [SOLANA_USDT_MINT_MAINNET]: "USDT",
  CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH: "CASH",
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": "USDG",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": "PYUSD",
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: "USDS",
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
