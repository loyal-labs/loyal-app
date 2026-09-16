// Mainnet RPC. Helius has no per-key method or rate rules, so an api-key in
// the bundle grants the whole project budget to anyone who extracts it. The
// previous keyed Gatekeeper URL (key 765be1fd, Jul 9 - Sep 2026) was picked up
// from this public repo and burned ~500k req/h from outside the app.
//
// This is the Helius project Secure URL (shared with web): host-authenticated,
// no api-key, limited by Helius to 5 req/s per source IP (the app polls
// ~2 req/min per user). EXPO_PUBLIC_SOLANA_MAINNET_RPC_URL overrides it per
// build; never put an api-key back in this file.
export const SECURE_MAINNET_RPC_URL =
  process.env.EXPO_PUBLIC_SOLANA_MAINNET_RPC_URL?.trim() ||
  "https://fredra-z7l52f-fast-mainnet.helius-rpc.com";

// Mobile does not open Solana WebSocket subscriptions. This endpoint is still
// passed to Anchor providers, which require a websocketEndpoint config even
// when they never call onAccountChange/onLogs. The public fallback is fine.
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

export const PER_DEVNET_RPC_ENDPOINT = "https://devnet-tee.magicblock.app";
export const PER_DEVNET_WS_ENDPOINT = "wss://devnet-tee.magicblock.app";
