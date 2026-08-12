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

export function sumPublicStablecoinParValueUsd(
  positions: readonly PortfolioPosition[],
  stablecoinMints: ReadonlySet<string>
): number {
  return positions.reduce((sum, position) => {
    if (!isStablecoinMint(position.asset.mint, stablecoinMints)) {
      return sum;
    }

    const balance = position.publicBalance;
    return typeof balance === "number" && Number.isFinite(balance)
      ? sum + balance
      : sum;
  }, 0);
}
