import {
  KAMINO_BITCOIN_MARKET,
  KAMINO_DEVNET_MAIN_MARKET,
  KAMINO_ETHENA_MARKET,
  KAMINO_FIGURE_MARKET,
  KAMINO_HUMA_MARKET,
  KAMINO_JLP_MARKET,
  KAMINO_MAIN_MARKET,
  KAMINO_MAPLE_MARKET,
  KAMINO_ONRE_MARKET,
  KAMINO_SOLSTICE_MARKET,
  KAMINO_SUPERSTATE_OPENING_BELL_MARKET,
  LoyalCluster,
  STABLECOIN_MINTS,
  STABLECOIN_MINTS_BY_CLUSTER,
  Stablecoin,
} from "@loyal-labs/actions";

export type EarnPositionDisplay = {
  label: string;
  marketName: string;
  mintSymbol: string;
};

const KNOWN_MARKET_NAMES = new Map([
  [KAMINO_MAIN_MARKET.toBase58(), "Main Kamino"],
  [KAMINO_DEVNET_MAIN_MARKET.toBase58(), "Main Kamino"],
  [KAMINO_FIGURE_MARKET.toBase58(), "Prime Market"],
  [KAMINO_MAPLE_MARKET.toBase58(), "Maple Market"],
  [KAMINO_ONRE_MARKET.toBase58(), "OnRe Market"],
  [KAMINO_ETHENA_MARKET.toBase58(), "Ethena Market"],
  [KAMINO_JLP_MARKET.toBase58(), "JLP Market"],
  [KAMINO_BITCOIN_MARKET.toBase58(), "Bitcoin Market"],
  [KAMINO_SUPERSTATE_OPENING_BELL_MARKET.toBase58(), "Superstate Market"],
  [KAMINO_HUMA_MARKET.toBase58(), "Huma Market"],
  [KAMINO_SOLSTICE_MARKET.toBase58(), "Solstice Market"],
]);

const COMPACT_MARKET_NAMES = new Map(
  [...KNOWN_MARKET_NAMES].map(([market, name]) => [
    market,
    name.replace(/\s+Market$/, ""),
  ])
);

// Default coin art for any Kamino market without a dedicated brand icon
// (Main + JLP/Bitcoin/Superstate/Huma/Solstice/etc.). Specific markets in
// the Safe basket get their own logo.
const DEFAULT_MARKET_ICON = "/wallet-workspace/earn-kamino.png";

const MARKET_ICONS = new Map<string, string>([
  [KAMINO_MAIN_MARKET.toBase58(), DEFAULT_MARKET_ICON],
  [KAMINO_DEVNET_MAIN_MARKET.toBase58(), DEFAULT_MARKET_ICON],
  [KAMINO_FIGURE_MARKET.toBase58(), "/wallet-workspace/earn-prime.png"],
  [KAMINO_MAPLE_MARKET.toBase58(), "/wallet-workspace/earn-maple.svg"],
  [KAMINO_ONRE_MARKET.toBase58(), "/wallet-workspace/earn-onre.png"],
  [KAMINO_ETHENA_MARKET.toBase58(), "/wallet-workspace/earn-ethena.png"],
]);

const devnetUsdcMint =
  STABLECOIN_MINTS_BY_CLUSTER[LoyalCluster.Devnet][Stablecoin.USDC]?.toBase58();

const KNOWN_MINT_SYMBOLS = new Map([
  [STABLECOIN_MINTS[Stablecoin.USDC].toBase58(), "USDC"],
  ...(devnetUsdcMint ? ([[devnetUsdcMint, "USDC"]] as const) : []),
]);

function shortenAddress(address: string): string {
  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function resolveEarnPositionDisplay(args: {
  liquidityMint: string;
  market: string | null;
}): EarnPositionDisplay {
  const marketName = args.market
    ? KNOWN_MARKET_NAMES.get(args.market) ?? shortenAddress(args.market)
    : "Unknown Market";
  const mintSymbol =
    KNOWN_MINT_SYMBOLS.get(args.liquidityMint) ??
    shortenAddress(args.liquidityMint);

  return {
    label: `${marketName} · ${mintSymbol}`,
    marketName,
    mintSymbol,
  };
}

export function resolveEarnTransactionMarketLabel(args: {
  liquidityMint: string | null | undefined;
  market: string | null | undefined;
  reserve?: string | null | undefined;
}): string {
  if (args.market) {
    return COMPACT_MARKET_NAMES.get(args.market) ?? shortenAddress(args.market);
  }

  if (args.reserve) {
    return shortenAddress(args.reserve);
  }

  return args.liquidityMint
    ? KNOWN_MINT_SYMBOLS.get(args.liquidityMint) ??
        shortenAddress(args.liquidityMint)
    : "position";
}

export function resolveEarnTransactionMarketIcon(args: {
  market: string | null | undefined;
}): string {
  return args.market
    ? MARKET_ICONS.get(args.market) ?? DEFAULT_MARKET_ICON
    : DEFAULT_MARKET_ICON;
}
