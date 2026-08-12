import "server-only";

import { Connection } from "@solana/web3.js";

import { serverEnv } from "@/lib/core/config/server";

let cachedConnection: Connection | null = null;

export function getPrivateMainnetRpcUrl(): string {
  return serverEnv.privateMainnetRpcUrl;
}

export function getPrivateMainnetConnection(): Connection {
  if (cachedConnection) return cachedConnection;
  cachedConnection = new Connection(getPrivateMainnetRpcUrl(), {
    commitment: "confirmed",
  });
  return cachedConnection;
}
