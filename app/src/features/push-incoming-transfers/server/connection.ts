import "server-only";

import { Connection } from "@solana/web3.js";

import { serverEnv } from "@/lib/core/config/server";

// Local cache — separate from private-transfer-analytics to keep feature
// boundaries clean. Points at the same RPC endpoint (serverEnv.privateMainnetRpcUrl).
let cachedConnection: Connection | null = null;

export function getIncomingTransferConnection(): Connection {
  if (cachedConnection) return cachedConnection;
  cachedConnection = new Connection(serverEnv.privateMainnetRpcUrl, {
    commitment: "confirmed",
  });
  return cachedConnection;
}
