// Host-based "secure RPC" mainnet endpoint from the `Dancerhail`
// Helius API key's project. Authentication is by hostname — no api key
// in URL, query, header, or env. Do NOT reintroduce
// `EXPO_PUBLIC_HELIUS_API_KEY` here: anything in EXPO_PUBLIC_* lands in
// the shipped JS bundle and is trivially extractable from the APK/IPA.
// The previous endpoint (Thumbvenom) was rotated out via ASK-1334.
export const SECURE_MAINNET_RPC_URL =
  "https://guendolen-nvqjc4-fast-mainnet.helius-rpc.com";

// Mobile no longer opens any Solana WebSocket subscriptions — incoming
// transfer pushes come via the Helius enhanced webhook → Expo push
// path (see /api/webhooks/helius). This endpoint is still passed to
// Anchor providers, which require a websocketEndpoint config even when
// they never call onAccountChange/onLogs. The public fallback is fine
// for that.
export const SECURE_MAINNET_RPC_WS = "wss://api.mainnet-beta.solana.com";

export const SECURE_DEVNET_RPC_URL =
  "https://karlotta-a6micy-fast-devnet.helius-rpc.com";
export const SECURE_DEVNET_RPC_WS = "wss://api.devnet.solana.com";

export const TESTNET_RPC_URL = "https://api.testnet.solana.com";
export const TESTNET_RPC_WS = "wss://api.testnet.solana.com";

export const LOCALNET_RPC_URL = "http://127.0.0.1:8899";
export const LOCALNET_RPC_WS = "ws://127.0.0.1:8900";

export const PER_MAINNET_RPC_ENDPOINT = "https://mainnet-tee.magicblock.app";
export const PER_MAINNET_WS_ENDPOINT = "wss://mainnet-tee.magicblock.app";

export const PER_DEVNET_RPC_ENDPOINT = "https://tee.magicblock.app";
export const PER_DEVNET_WS_ENDPOINT = "wss://tee.magicblock.app";
