import "server-only";

import { Connection } from "@solana/web3.js";

import { serverEnv } from "@/lib/core/config/server";

// Dedicated cached connection for the shielded-transfers cron. Shares
// the RPC endpoint with the other push crons so we don't explode the
// connection count per Vercel function instance.
let cachedConnection: Connection | null = null;

export function getPushShieldedTransfersConnection(): Connection {
  if (cachedConnection) return cachedConnection;
  cachedConnection = new Connection(serverEnv.privateMainnetRpcUrl, {
    commitment: "confirmed",
  });
  return cachedConnection;
}
