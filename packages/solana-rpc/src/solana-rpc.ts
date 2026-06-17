export const SOLANA_ENVS = [
  "mainnet",
  "testnet",
  "devnet",
  "localnet",
] as const;

export type SolanaEnv = (typeof SOLANA_ENVS)[number];

export type SolanaEndpoints = {
  rpcEndpoint: string;
  websocketEndpoint: string;
};

export type PerEndpoints = {
  perRpcEndpoint: string;
  perWsEndpoint: string;
};

const DEFAULT_SOLANA_ENV: SolanaEnv = "devnet";
const MAINNET_SOLANA_ENDPOINTS: SolanaEndpoints = {
  rpcEndpoint: "https://fredra-z7l52f-fast-mainnet.helius-rpc.com",
  websocketEndpoint: "wss://fredra-z7l52f-fast-mainnet.helius-rpc.com",
};
const DEVNET_SOLANA_ENDPOINTS: SolanaEndpoints = {
  rpcEndpoint: "https://karlotta-a6micy-fast-devnet.helius-rpc.com",
  websocketEndpoint: "wss://karlotta-a6micy-fast-devnet.helius-rpc.com",
};
const TESTNET_SOLANA_ENDPOINTS: SolanaEndpoints = {
  rpcEndpoint: "https://api.testnet.solana.com",
  websocketEndpoint: "wss://api.testnet.solana.com",
};
const LOCALNET_SOLANA_ENDPOINTS: SolanaEndpoints = {
  rpcEndpoint: "http://127.0.0.1:8899",
  websocketEndpoint: "ws://127.0.0.1:8900",
};
const MAINNET_PER_ENDPOINTS: PerEndpoints = {
  perRpcEndpoint: "https://mainnet-tee.magicblock.app",
  perWsEndpoint: "wss://mainnet-tee.magicblock.app",
};
const NON_MAINNET_PER_ENDPOINTS: PerEndpoints = {
  perRpcEndpoint: "https://tee.magicblock.app",
  perWsEndpoint: "wss://tee.magicblock.app",
};
const SOLANA_ENDPOINTS_BY_ENV: Record<SolanaEnv, SolanaEndpoints> = {
  mainnet: MAINNET_SOLANA_ENDPOINTS,
  testnet: TESTNET_SOLANA_ENDPOINTS,
  devnet: DEVNET_SOLANA_ENDPOINTS,
  localnet: LOCALNET_SOLANA_ENDPOINTS,
};
const PER_ENDPOINTS_BY_ENV: Record<SolanaEnv, PerEndpoints> = {
  mainnet: MAINNET_PER_ENDPOINTS,
  // Keep non-mainnet environments aligned on the devnet PER cluster until
  // dedicated testnet/localnet PER endpoints exist.
  testnet: NON_MAINNET_PER_ENDPOINTS,
  devnet: NON_MAINNET_PER_ENDPOINTS,
  localnet: NON_MAINNET_PER_ENDPOINTS,
};

const isSolanaEnv = (value: string): value is SolanaEnv =>
  SOLANA_ENVS.includes(value as SolanaEnv);

const trimOptionalValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const resolveSolanaEnv = (
  value?: string,
  defaultEnv: SolanaEnv = DEFAULT_SOLANA_ENV
): SolanaEnv => {
  const normalizedValue = trimOptionalValue(value);
  if (!normalizedValue) {
    return defaultEnv;
  }

  return isSolanaEnv(normalizedValue) ? normalizedValue : defaultEnv;
};

export const getSolanaEndpoints = (env: SolanaEnv): SolanaEndpoints => {
  return SOLANA_ENDPOINTS_BY_ENV[env];
};

export const getPerEndpoints = (env: SolanaEnv): PerEndpoints => {
  return PER_ENDPOINTS_BY_ENV[env];
};
