import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { getOptionalEnv, type EnvSource } from "./shared";

const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";
const DEFAULT_LOYAL_WEB_SOLANA_ENV: OverridableSolanaEnv = "mainnet";

export type OverridableSolanaEnv = Extract<SolanaEnv, "mainnet" | "devnet">;

function normalizeLoyalWebSolanaEnv(
  value: string | undefined
): OverridableSolanaEnv | null {
  const normalizedValue = value?.trim();
  if (normalizedValue === "mainnet" || normalizedValue === "devnet") {
    return normalizedValue;
  }
  return null;
}

export function resolveLoyalWebSolanaEnv(
  value: string | undefined
): OverridableSolanaEnv {
  return normalizeLoyalWebSolanaEnv(value) ?? DEFAULT_LOYAL_WEB_SOLANA_ENV;
}

export function resolveLoyalWebSolanaEnvFromEnv(
  env: EnvSource
): OverridableSolanaEnv {
  return resolveLoyalWebSolanaEnv(getOptionalEnv(env, SOLANA_ENV_ENV_NAME));
}
