import {
  getPerEndpoints as getSharedPerEndpoints,
  getSolanaEndpoints as getSharedSolanaEndpoints,
  type SolanaEnv,
} from "@loyal-labs/solana-rpc";
import { Connection } from "@solana/web3.js";

import { publicEnv } from "@/lib/core/config/public";

import { attachWsDebugLogging } from "./ws-debug";

export const getSolanaEnv = (): SolanaEnv => {
  if (typeof window !== "undefined") {
    const override = localStorage.getItem("solana-env-override");
    if (
      override === "mainnet" ||
      override === "testnet" ||
      override === "devnet" ||
      override === "localnet"
    ) {
      return override;
    }
  }

  return publicEnv.solanaEnv;
};

export const getEndpoints = (
  env: SolanaEnv
): { rpcEndpoint: string; websocketEndpoint: string } => {
  return getSharedSolanaEndpoints(env);
};

export const getPerEndpoints = (
  env: SolanaEnv
): { perRpcEndpoint: string; perWsEndpoint: string } => {
  return getSharedPerEndpoints(env);
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
  attachWsDebugLogging(cachedConnection, "app:solana:rpc");
  return cachedConnection;
};

export const getWebsocketConnection = (): Connection => {
  if (cachedWebsocketConnection) return cachedWebsocketConnection;
  cachedWebsocketConnection = new Connection(rpcEndpoint, {
    ...connectionConfig,
    wsEndpoint: websocketEndpoint,
  });
  attachWsDebugLogging(cachedWebsocketConnection, "app:solana:websocket");
  return cachedWebsocketConnection;
};
