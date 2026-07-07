import "server-only";

import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection } from "@solana/web3.js";

import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

const serverSolanaConnectionCache = new Map<SolanaEnv, Connection>();

export function getServerSolanaConnection(cluster: SolanaEnv): Connection {
  const cached = serverSolanaConnectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  serverSolanaConnectionCache.set(cluster, connection);
  return connection;
}
