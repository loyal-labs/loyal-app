import {
  getSolanaEndpoints as getSharedSolanaEndpoints,
  type SolanaEndpoints,
  type SolanaEnv,
} from "@loyal-labs/solana-rpc";

const FRONTEND_SOLANA_ENDPOINTS_BY_ENV: Partial<
  Record<SolanaEnv, SolanaEndpoints>
> = {
  devnet: {
    rpcEndpoint: "https://karlotta-a6micy-fast-devnet.helius-rpc.com",
    websocketEndpoint: "wss://karlotta-a6micy-fast-devnet.helius-rpc.com",
  },
  mainnet: {
    rpcEndpoint: "https://fredra-z7l52f-fast-mainnet.helius-rpc.com",
    websocketEndpoint: "wss://fredra-z7l52f-fast-mainnet.helius-rpc.com",
  },
};

export function getFrontendSolanaEndpoints(env: SolanaEnv): SolanaEndpoints {
  return FRONTEND_SOLANA_ENDPOINTS_BY_ENV[env] ?? getSharedSolanaEndpoints(env);
}
