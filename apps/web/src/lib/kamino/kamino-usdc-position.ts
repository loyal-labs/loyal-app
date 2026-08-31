import type { SolanaEnv } from "@loyal-labs/solana-rpc";

export const SOLANA_USDC_MINT_MAINNET =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_USDC_MINT_DEVNET =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export function resolveTrackedKaminoUsdcMint(
  solanaEnv: SolanaEnv
): string | null {
  if (solanaEnv === "mainnet") {
    return SOLANA_USDC_MINT_MAINNET;
  }

  if (solanaEnv === "devnet") {
    return SOLANA_USDC_MINT_DEVNET;
  }

  return null;
}
