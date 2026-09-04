import "server-only";

import type { SolanaEndpoints, SolanaEnv } from "@loyal-labs/solana-rpc";

import { getFrontendSolanaEndpoints } from "./rpc-endpoints";

function readServerEndpointOverride(env: SolanaEnv): SolanaEndpoints | null {
  if (env === "localnet") {
    return null;
  }

  const envPrefix = env.toUpperCase();
  const rpcEndpoint =
    process.env[`SOLANA_${envPrefix}_RPC_URL`]?.trim() ||
    (env === "mainnet" ? process.env.SOLANA_RPC_URL?.trim() : undefined);
  if (!rpcEndpoint) {
    return null;
  }

  const publicEndpoints = getFrontendSolanaEndpoints(env);
  return {
    rpcEndpoint,
    websocketEndpoint:
      process.env[`SOLANA_${envPrefix}_WEBSOCKET_URL`]?.trim() ||
      process.env.SOLANA_WEBSOCKET_URL?.trim() ||
      publicEndpoints.websocketEndpoint,
  };
}

export function getServerSolanaEndpoints(env: SolanaEnv): SolanaEndpoints {
  return readServerEndpointOverride(env) ?? getFrontendSolanaEndpoints(env);
}
