import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import { LoyalCluster } from "./types.ts";

export type LoyalClusterConfig = {
  squadsSmartAccountProgramId: PublicKey;
  jupiterV6ProgramId: PublicKey;
  loyalHubSwapProgramId: PublicKey;
  loyalHubAuthorizer: PublicKey;
  tokenProgramId: PublicKey;
  associatedTokenProgramId: PublicKey;
};

const sharedConfig: LoyalClusterConfig = {
  squadsSmartAccountProgramId: new PublicKey(
    "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"
  ),
  jupiterV6ProgramId: new PublicKey(
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
  ),
  loyalHubSwapProgramId: new PublicKey(
    "3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh"
  ),
  loyalHubAuthorizer: new PublicKey(
    "3uWi9x2SRpmjztkpkr2WWeBoVq3exjXG2YfDWLvm8KsQ"
  ),
  tokenProgramId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  associatedTokenProgramId: new PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
  ),
};

export const LOYAL_CLUSTER_CONFIGS: Record<LoyalCluster, LoyalClusterConfig> = {
  [LoyalCluster.Devnet]: sharedConfig,
  [LoyalCluster.MainnetBeta]: sharedConfig,
};

export function clusterConfigFor(cluster: LoyalCluster): LoyalClusterConfig {
  const config = LOYAL_CLUSTER_CONFIGS[cluster];
  if (!config) {
    throw new Error(`unsupported Loyal cluster: ${String(cluster)}`);
  }
  return config;
}

export function normalizeLoyalCluster(value: string): LoyalCluster {
  const normalizedValue = value.trim();
  if (normalizedValue === LoyalCluster.Devnet) {
    return LoyalCluster.Devnet;
  }
  if (
    normalizedValue === LoyalCluster.MainnetBeta ||
    normalizedValue === "mainnet"
  ) {
    return LoyalCluster.MainnetBeta;
  }
  throw new Error(`unsupported Loyal cluster: ${value}`);
}

export function resolveLoyalClusterForSolanaEnv(env: SolanaEnv): LoyalCluster {
  if (env === "devnet") {
    return LoyalCluster.Devnet;
  }
  if (env === "mainnet") {
    return LoyalCluster.MainnetBeta;
  }
  throw new Error(`Earn persistence does not support Solana env: ${env}`);
}
