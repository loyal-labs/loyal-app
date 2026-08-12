const LOGO_DEV_PUBLIC_KEY = "pk_Q3rdnWfqS8SUdYfXkMFweQ";

const LOGO_DEV_SYMBOLS = new Set([
  "SOL",
  "USDC",
  "USDT",
  "CASH",
  "USDG",
  "PYUSD",
  "USDS",
  "BNB",
  "WBTC",
  "ETH",
  "BTC",
  "BONK",
  "JUP",
  "RAY",
  "ORCA",
  "PYTH",
  "WIF",
  "JTO",
  "HNT",
  "RENDER",
  "MOBILE",
]);

const GENERIC_TOKEN_ICON = "/hero-new/Wallet-Cover.png";
const TOKEN_ICON_OVERRIDES: Record<string, string> = {
  SOL: "https://coin-images.coingecko.com/coins/images/21629/large/solana.jpg",
  USDC: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
  // logo.dev resolves these ambiguous tickers to the wrong project (CASH) or
  // a letter placeholder (USDG); pin the issuers' canonical marks instead.
  CASH: "https://token-metadata.bridge.xyz/images/cash.png",
  USDG: "https://424565.fs1.hubspotusercontent-na1.net/hubfs/424565/GDN-USDG-Token-512x512.png",
};

export function getTokenIconUrl(symbol: string): string {
  const normalizedSymbol = symbol.toUpperCase();

  if (TOKEN_ICON_OVERRIDES[normalizedSymbol]) {
    return TOKEN_ICON_OVERRIDES[normalizedSymbol];
  }

  if (LOGO_DEV_SYMBOLS.has(normalizedSymbol)) {
    return `https://img.logo.dev/crypto/${normalizedSymbol}?token=${LOGO_DEV_PUBLIC_KEY}`;
  }
  return GENERIC_TOKEN_ICON;
}
