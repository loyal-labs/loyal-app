import {
  getStablecoinMintForCluster,
  getStablecoinsForCluster,
  type LoyalCluster,
  Stablecoin,
} from "@loyal-labs/actions";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const EARN_PRODUCT_STABLECOINS = [
  Stablecoin.CASH,
  Stablecoin.USDG,
  Stablecoin.PYUSD,
  Stablecoin.USDC,
  Stablecoin.USDT,
  Stablecoin.USDS,
] as const;

export type EarnProductStablecoin = (typeof EARN_PRODUCT_STABLECOINS)[number];

export interface EarnProductAsset {
  decimals: 6;
  mint: PublicKey;
  stablecoin: EarnProductStablecoin;
  symbol: EarnProductStablecoin;
  tokenProgramId: PublicKey;
}

const TOKEN_2022_STABLECOINS = new Set<EarnProductStablecoin>([
  Stablecoin.CASH,
  Stablecoin.USDG,
  Stablecoin.PYUSD,
]);

function tokenProgramFor(stablecoin: EarnProductStablecoin): PublicKey {
  return TOKEN_2022_STABLECOINS.has(stablecoin)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

export function getEarnProductAssetsForCluster(
  cluster: LoyalCluster
): readonly EarnProductAsset[] {
  const clusterStablecoins = new Set(getStablecoinsForCluster(cluster));
  return EARN_PRODUCT_STABLECOINS.filter((stablecoin) =>
    clusterStablecoins.has(stablecoin)
  ).map((stablecoin) => ({
    decimals: 6,
    mint: getStablecoinMintForCluster(cluster, stablecoin),
    stablecoin,
    symbol: stablecoin,
    tokenProgramId: tokenProgramFor(stablecoin),
  }));
}

export function resolveEarnProductAsset(args: {
  cluster: LoyalCluster;
  // null = legacy deposit body that predates mint selection; those clients
  // always meant USDC (ASK-2099).
  mint: string | PublicKey | null;
}): EarnProductAsset {
  const mint =
    args.mint === null
      ? getStablecoinMintForCluster(args.cluster, Stablecoin.USDC)
      : typeof args.mint === "string"
      ? new PublicKey(args.mint)
      : args.mint;
  const asset = getEarnProductAssetsForCluster(args.cluster).find((candidate) =>
    candidate.mint.equals(mint)
  );
  if (!asset) {
    throw new Error("mint is not a supported Earn product mint.");
  }
  return asset;
}

/** The browser sends only money intent. Trusted code derives all metadata. */
export function buildEarnDepositIntent(args: {
  amountRaw: bigint;
  mint: PublicKey;
}): { amountRaw: string; mint: string } {
  if (args.amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }
  return { amountRaw: args.amountRaw.toString(), mint: args.mint.toBase58() };
}
