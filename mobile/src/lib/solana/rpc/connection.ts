import { Connection } from "@solana/web3.js";

import {
  LOCALNET_RPC_URL,
  LOCALNET_RPC_WS,
  PER_DEVNET_RPC_ENDPOINT,
  PER_DEVNET_WS_ENDPOINT,
  PER_MAINNET_RPC_ENDPOINT,
  PER_MAINNET_WS_ENDPOINT,
  SECURE_DEVNET_RPC_URL,
  SECURE_DEVNET_RPC_WS,
  SECURE_MAINNET_RPC_URL,
  SECURE_MAINNET_RPC_WS,
  TESTNET_RPC_URL,
  TESTNET_RPC_WS,
} from "./constants";
import type { SolanaEnv } from "./types";

export const getSolanaEnv = (): SolanaEnv => {
  const env = process.env.EXPO_PUBLIC_SOLANA_ENV ?? "devnet";
  if (
    env === "mainnet" ||
    env === "testnet" ||
    env === "devnet" ||
    env === "localnet"
  ) {
    return env;
  }
  return "devnet";
};

export const getEndpoints = (
  env: SolanaEnv
): { rpcEndpoint: string; websocketEndpoint: string } => {
  switch (env) {
    case "mainnet":
      return {
        rpcEndpoint: SECURE_MAINNET_RPC_URL,
        websocketEndpoint: SECURE_MAINNET_RPC_WS,
      };
    case "testnet":
      return {
        rpcEndpoint: TESTNET_RPC_URL,
        websocketEndpoint: TESTNET_RPC_WS,
      };
    case "localnet":
      return {
        rpcEndpoint: LOCALNET_RPC_URL,
        websocketEndpoint: LOCALNET_RPC_WS,
      };
    case "devnet":
    default:
      return {
        rpcEndpoint: SECURE_DEVNET_RPC_URL,
        websocketEndpoint: SECURE_DEVNET_RPC_WS,
      };
  }
};

export const getPerEndpoints = (
  env: SolanaEnv
): { perRpcEndpoint: string; perWsEndpoint: string } => {
  switch (env) {
    case "mainnet":
      return {
        perRpcEndpoint: PER_MAINNET_RPC_ENDPOINT,
        perWsEndpoint: PER_MAINNET_WS_ENDPOINT,
      };
    case "devnet":
    default:
      return {
        perRpcEndpoint: PER_DEVNET_RPC_ENDPOINT,
        perWsEndpoint: PER_DEVNET_WS_ENDPOINT,
      };
  }
};

const selectedSolanaEnv = getSolanaEnv();
export const { rpcEndpoint, websocketEndpoint } =
  getEndpoints(selectedSolanaEnv);
export const { perRpcEndpoint, perWsEndpoint } =
  getPerEndpoints(selectedSolanaEnv);

let cachedConnection: Connection | null = null;
let cachedWebsocketConnection: Connection | null = null;
const connectionConfig = { commitment: "confirmed" as const };

export const getConnection = (): Connection => {
  if (cachedConnection) return cachedConnection;
  cachedConnection = new Connection(rpcEndpoint, connectionConfig);
  return cachedConnection;
};

export const getWebsocketConnection = (): Connection => {
  if (cachedWebsocketConnection) return cachedWebsocketConnection;
  cachedWebsocketConnection = new Connection(rpcEndpoint, {
    ...connectionConfig,
    wsEndpoint: websocketEndpoint,
  });
  return cachedWebsocketConnection;
};
