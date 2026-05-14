import { Connection } from "@solana/web3.js";

import { mmkv } from "@/lib/storage";

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

const SOLANA_ENV_OVERRIDE_KEY = "settings_solana_env";

const envChangeListeners = new Set<(env: SolanaEnv) => void>();

export const onSolanaEnvChange = (cb: (env: SolanaEnv) => void) => {
  envChangeListeners.add(cb);
  return () => { envChangeListeners.delete(cb); };
};

function resolveEnv(raw: string | undefined): SolanaEnv {
  if (
    raw === "mainnet" ||
    raw === "testnet" ||
    raw === "devnet" ||
    raw === "localnet"
  ) {
    return raw;
  }
  return "devnet";
}

export const getSolanaEnv = (): SolanaEnv => {
  const override = mmkv.getString(SOLANA_ENV_OVERRIDE_KEY);
  if (override) return resolveEnv(override);
  return resolveEnv(process.env.EXPO_PUBLIC_SOLANA_ENV);
};

export const setSolanaEnvOverride = (env: SolanaEnv): void => {
  mmkv.setString(SOLANA_ENV_OVERRIDE_KEY, env);
  invalidateConnectionCache();
  envChangeListeners.forEach((cb) => cb(env));
};

export const clearSolanaEnvOverride = (): void => {
  mmkv.delete(SOLANA_ENV_OVERRIDE_KEY);
  invalidateConnectionCache();
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

let cachedConnection: Connection | null = null;
let cachedWebsocketConnection: Connection | null = null;
let cachedEnv: SolanaEnv | null = null;
const connectionConfig = { commitment: "confirmed" as const };

function invalidateConnectionCache(): void {
  cachedConnection = null;
  cachedWebsocketConnection = null;
  cachedEnv = null;
}

function ensureEnv(): SolanaEnv {
  const env = getSolanaEnv();
  if (cachedEnv && cachedEnv !== env) {
    invalidateConnectionCache();
  }
  cachedEnv = env;
  return env;
}

export const getConnection = (): Connection => {
  const env = ensureEnv();
  if (cachedConnection) return cachedConnection;
  const { rpcEndpoint } = getEndpoints(env);
  cachedConnection = new Connection(rpcEndpoint, connectionConfig);
  return cachedConnection;
};

export const getWebsocketConnection = (): Connection => {
  const env = ensureEnv();
  if (cachedWebsocketConnection) return cachedWebsocketConnection;
  const { rpcEndpoint, websocketEndpoint } = getEndpoints(env);
  cachedWebsocketConnection = new Connection(rpcEndpoint, {
    ...connectionConfig,
    wsEndpoint: websocketEndpoint,
  });
  return cachedWebsocketConnection;
};
