import {
  KAMINO_DEVNET_MAIN_MARKET,
  KAMINO_MAIN_MARKET,
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
]);

const devnetUsdcMint =
  STABLECOIN_MINTS_BY_CLUSTER[LoyalCluster.Devnet][
    Stablecoin.USDC
  ]?.toBase58();

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
    ? (KNOWN_MARKET_NAMES.get(args.market) ?? shortenAddress(args.market))
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
