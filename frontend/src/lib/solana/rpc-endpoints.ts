import {
  getSolanaEndpoints as getSharedSolanaEndpoints,
  type SolanaEndpoints,
  type SolanaEnv,
} from "@loyal-labs/solana-rpc";

const FRONTEND_SOLANA_ENDPOINTS_BY_ENV: Partial<
  Record<SolanaEnv, SolanaEndpoints>
> = {
  devnet: {
    rpcEndpoint: "https://aurora-o23cd4-fast-devnet.helius-rpc.com",
    websocketEndpoint: "wss://aurora-o23cd4-fast-devnet.helius-rpc.com",
  },
  mainnet: {
    rpcEndpoint: "https://guendolen-nvqjc4-fast-mainnet.helius-rpc.com",
    websocketEndpoint: "wss://guendolen-nvqjc4-fast-mainnet.helius-rpc.com",
  },
};

function readEndpointOverride(env: SolanaEnv): SolanaEndpoints | null {
  const envSource =
    typeof process === "undefined"
      ? undefined
      : (process.env as Record<string, string | undefined>);
  const envPrefix = env.toUpperCase();
  const rpcEndpoint =
    envSource?.[`SOLANA_${envPrefix}_RPC_URL`]?.trim() ||
    (env === "mainnet" ? envSource?.SOLANA_RPC_URL?.trim() : undefined);
  if (!rpcEndpoint || env === "localnet") {
    return null;
  }

  return {
    rpcEndpoint,
    websocketEndpoint:
      envSource?.[`SOLANA_${envPrefix}_WEBSOCKET_URL`]?.trim() ||
      envSource?.SOLANA_WEBSOCKET_URL?.trim() ||
      FRONTEND_SOLANA_ENDPOINTS_BY_ENV[env]?.websocketEndpoint ||
      getSharedSolanaEndpoints(env).websocketEndpoint,
  };
}

export function getFrontendSolanaEndpoints(
  env: SolanaEnv
): SolanaEndpoints {
  const override = readEndpointOverride(env);
  if (override) {
    return override;
  }

  return FRONTEND_SOLANA_ENDPOINTS_BY_ENV[env] ?? getSharedSolanaEndpoints(env);
}
