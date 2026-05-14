import type { SolanaEnv } from "@loyal-labs/solana-rpc";

export const SOLANA_ENV_OVERRIDE_COOKIE = "loyal-solana-env-override";

export type OverridableSolanaEnv = Extract<SolanaEnv, "mainnet" | "devnet">;

export function resolveSolanaEnvOverride(
  value: string | undefined
): OverridableSolanaEnv | null {
  if (value === "mainnet" || value === "devnet") {
    return value;
  }
  return null;
}
