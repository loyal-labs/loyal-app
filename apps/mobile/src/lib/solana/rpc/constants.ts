// Helius Gatekeeper mainnet endpoint. The api key in the URL is exposed
// by design — Gatekeeper enforces per-key method/rate rules server-side,
// so extracting it from the bundle (or this public repo) only grants the
// same gated access the app has. This key's budget is separate from the
// backend's keyed RPC, so mobile traffic no longer competes with server
// routes for the same rate limit. Replaced the host-authenticated
// "secure RPC" URL (Dancerhail project, rotated in via ASK-1334) on
// 2026-07-09 during the RPC saturation incident.
export const SECURE_MAINNET_RPC_URL =
  "https://beta.helius-rpc.com/?api-key=765be1fd-1402-443f-aba4-f41fe30bae1d";

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
