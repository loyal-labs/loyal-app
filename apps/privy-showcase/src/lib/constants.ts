import { LoyalCluster } from "@loyal-labs/actions";
import { PROGRAM_ID } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

export const DEMO_CLUSTER = LoyalCluster.MainnetBeta;
export const DEMO_CLUSTER_NAME = "mainnet-beta" as const;
export const MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" as const;
export const SQUADS_PROGRAM_ID = PROGRAM_ID;
export const CANONICAL_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const EARN_VAULT_INDEX = 1;
export const DEFAULT_RPC_URL =
  "https://guendolen-nvqjc4-fast-mainnet.helius-rpc.com";
export const DEFAULT_WS_URL =
  "wss://guendolen-nvqjc4-fast-mainnet.helius-rpc.com";

export function assertMainnetRpcUrl(value: string): string {
  const lower = value.toLowerCase();
  if (
    lower.includes("devnet") ||
    lower.includes("testnet") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1")
  ) {
    throw new Error("The Privy showcase is mainnet-only.");
  }
  return value;
}

export function getPublicRpcUrl(): string {
  return assertMainnetRpcUrl(DEFAULT_RPC_URL);
}

export function getPublicWsUrl(): string {
  return assertMainnetRpcUrl(DEFAULT_WS_URL);
}
