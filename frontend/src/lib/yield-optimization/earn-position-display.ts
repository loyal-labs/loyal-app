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
  [KAMINO_MAIN_MARKET.toBase58(), "Main Market"],
  [KAMINO_DEVNET_MAIN_MARKET.toBase58(), "Main Market"],
  [KAMINO_FIGURE_MARKET.toBase58(), "Figure Market"],
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
  const mintSymbol = args.liquidityMint
    ? KNOWN_MINT_SYMBOLS.get(args.liquidityMint) ??
      shortenAddress(args.liquidityMint)
    : "position";

  if (!args.market) {
    return args.reserve
      ? `${shortenAddress(args.reserve)} ${mintSymbol}`
      : mintSymbol;
  }

  const marketName =
    COMPACT_MARKET_NAMES.get(args.market) ?? shortenAddress(args.market);

  return `${marketName} ${mintSymbol}`;
}
