export const SECURE_MAINNET_RPC_URL =
  "https://fredra-z7l52f-fast-mainnet.helius-rpc.com";
// Helius dedicated-endpoint WSS refused connections (the original FIXME
// flagged this). REST stays on the Helius dedicated endpoint (host-based
// tenant auth); WSS uses the Helius public endpoint with an api-key so
// onAccountChange/onLogs subscriptions actually register. The key is
// intentionally in the mobile bundle — Helius lets us rotate per-project
// and rate-limit cheaply, which is the standard tradeoff for RN crypto
// apps. If the env var is unset (local dev without .env), we fall back
// to the public mainnet-beta RPC so WS at least functions, rate-limited.
const HELIUS_API_KEY = process.env.EXPO_PUBLIC_HELIUS_API_KEY ?? "";
export const SECURE_MAINNET_RPC_WS = HELIUS_API_KEY
  ? `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : "wss://api.mainnet-beta.solana.com";

export const SECURE_DEVNET_RPC_URL =
  "https://karlotta-a6micy-fast-devnet.helius-rpc.com";
// export const SECURE_DEVNET_RPC_WS =
//   "wss://aurora-o23cd4-fast-devnet.helius-rpc.com";

// export const SECURE_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const SECURE_DEVNET_RPC_WS = "wss://api.devnet.solana.com";

export const TESTNET_RPC_URL = "https://api.testnet.solana.com";
export const TESTNET_RPC_WS = "wss://api.testnet.solana.com";

export const LOCALNET_RPC_URL = "http://127.0.0.1:8899";
export const LOCALNET_RPC_WS = "ws://127.0.0.1:8900";

export const PER_MAINNET_RPC_ENDPOINT = "https://mainnet-tee.magicblock.app";
export const PER_MAINNET_WS_ENDPOINT = "wss://mainnet-tee.magicblock.app";

export const PER_DEVNET_RPC_ENDPOINT = "https://tee.magicblock.app";
export const PER_DEVNET_WS_ENDPOINT = "wss://tee.magicblock.app";
