import { Connection } from "@solana/web3.js";

import { attachWsDebugLogging } from "@/lib/solana/rpc/ws-debug";

import { MAGICBLOCK_DEVNET_RPC_URL } from "./constants";

let cachedEphemeralConnection: Connection | null = null;

export const getEphemeralConnection = (): Connection => {
  if (cachedEphemeralConnection) return cachedEphemeralConnection;

  cachedEphemeralConnection = new Connection(MAGICBLOCK_DEVNET_RPC_URL, {
    commitment: "confirmed",
  });
  attachWsDebugLogging(cachedEphemeralConnection, "app:magicblock:ephemeral");
  return cachedEphemeralConnection;
};
