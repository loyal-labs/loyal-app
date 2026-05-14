const LOGO_DEV_PUBLIC_KEY = "pk_Q3rdnWfqS8SUdYfXkMFweQ";

const LOGO_DEV_SYMBOLS = new Set([
  "SOL",
  "USDC",
  "USDT",
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
