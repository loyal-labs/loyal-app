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

export const EARN_ENABLED_STABLECOINS_ENV_NAME =
  "NEXT_PUBLIC_EARN_ENABLED_STABLECOINS";

const DEFAULT_ENABLED_EARN_STABLECOINS = [Stablecoin.USDC] as const;

export interface EarnProductAsset {
  decimals: 6;
  mint: PublicKey;
  stablecoin: EarnProductStablecoin;
  symbol: EarnProductStablecoin;
  tokenProgramId: PublicKey;
}

export class EarnMintNotEnabledError extends Error {
  readonly code = "earn_mint_not_enabled";

  constructor(symbol: EarnProductStablecoin) {
    super(`${symbol} deposits are not enabled.`);
    this.name = "EarnMintNotEnabledError";
  }
}

export function parseEnabledEarnStablecoins(
  raw: string | undefined
): readonly EarnProductStablecoin[] {
  if (!raw?.trim()) {
    return DEFAULT_ENABLED_EARN_STABLECOINS;
  }

  const entries = raw.split(",").map((entry) => entry.trim());
  const supported = new Set<string>(EARN_PRODUCT_STABLECOINS);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!(entry && supported.has(entry))) {
      throw new Error(
        `${EARN_ENABLED_STABLECOINS_ENV_NAME} contains unsupported stablecoin ${JSON.stringify(entry)}.`
      );
    }
    if (seen.has(entry)) {
      throw new Error(
        `${EARN_ENABLED_STABLECOINS_ENV_NAME} contains duplicate stablecoin ${entry}.`
      );
    }
    seen.add(entry);
  }

  return EARN_PRODUCT_STABLECOINS.filter((stablecoin) => seen.has(stablecoin));
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

export function getEnabledEarnProductAssetsForCluster(args: {
  cluster: LoyalCluster;
  enabledStablecoins: readonly EarnProductStablecoin[];
}): readonly EarnProductAsset[] {
  const enabled = new Set(args.enabledStablecoins);
  return getEarnProductAssetsForCluster(args.cluster).filter((asset) =>
    enabled.has(asset.stablecoin)
  );
}

export function resolveEarnProductAsset(args: {
  cluster: LoyalCluster;
  mint: string | PublicKey;
}): EarnProductAsset {
  const mint =
    typeof args.mint === "string" ? new PublicKey(args.mint) : args.mint;
  const asset = getEarnProductAssetsForCluster(args.cluster).find((candidate) =>
    candidate.mint.equals(mint)
  );
  if (!asset) {
    throw new Error("mint is not a supported Earn product mint.");
  }
  return asset;
}

export function resolveEnabledEarnProductAsset(args: {
  cluster: LoyalCluster;
  enabledStablecoins: readonly EarnProductStablecoin[];
  mint: string | PublicKey;
}): EarnProductAsset {
  const asset = resolveEarnProductAsset(args);
  if (!args.enabledStablecoins.includes(asset.stablecoin)) {
    throw new EarnMintNotEnabledError(asset.symbol);
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
