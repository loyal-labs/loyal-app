import {
  getStablecoinMintsForCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

export function getStablecoinMintSetForSolanaEnv(
  solanaEnv: SolanaEnv
): ReadonlySet<string> {
  try {
    const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
    return new Set(
      getStablecoinMintsForCluster(cluster).map((mint) => mint.toBase58())
    );
  } catch {
    return new Set();
  }
}

export function isStablecoinMint(
  mint: string | null | undefined,
  stablecoinMints: ReadonlySet<string>
): boolean {
  return typeof mint === "string" && stablecoinMints.has(mint);
}

export function sumPublicStablecoinUsd(
  positions: readonly PortfolioPosition[],
  stablecoinMints: ReadonlySet<string>
): number {
  return positions.reduce((sum, position) => {
    if (!isStablecoinMint(position.asset.mint, stablecoinMints)) {
      return sum;
    }

    const valueUsd = position.publicValueUsd;
    return typeof valueUsd === "number" && Number.isFinite(valueUsd)
      ? sum + valueUsd
      : sum;
  }, 0);
}
