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

export function getFrontendSolanaEndpoints(
  env: SolanaEnv
): SolanaEndpoints {
  return FRONTEND_SOLANA_ENDPOINTS_BY_ENV[env] ?? getSharedSolanaEndpoints(env);
}
