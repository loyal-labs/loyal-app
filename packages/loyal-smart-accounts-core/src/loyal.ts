import { Connection, type Commitment } from "@solana/web3.js";
import { getSolanaEndpoints, type SolanaEnv } from "@loyal-labs/solana-rpc";
import type { LoyalSmartAccountsClientConfig } from "./transport.js";

type CreateConnection = (
  rpcEndpoint: string,
  websocketEndpoint: string,
  commitment: Commitment
) => Connection;

export type LoyalSmartAccountsConnectionCache = Map<string, Connection>;

export type LoyalSmartAccountsConnectionConfig = {
  env: SolanaEnv;
  commitment?: Commitment;
  connection?: Connection;
  createConnection?: CreateConnection;
  cache?: LoyalSmartAccountsConnectionCache;
};

export type ResolveLoyalSmartAccountsClientConfigFromEnvInput = Omit<
  LoyalSmartAccountsClientConfig,
  "connection" | "defaultCommitment"
> &
  LoyalSmartAccountsConnectionConfig;

const DEFAULT_COMMITMENT: Commitment = "confirmed";

function getCacheKey(
  rpcEndpoint: string,
  websocketEndpoint: string,
  commitment: Commitment
): string {
  return `${rpcEndpoint}::${websocketEndpoint}::${commitment}`;
}

export function createLoyalSmartAccountsConnectionCache(): LoyalSmartAccountsConnectionCache {
  return new Map<string, Connection>();
}

export function resetLoyalSmartAccountsConnectionCache(
  cache: LoyalSmartAccountsConnectionCache
): void {
  cache.clear();
}

export function getLoyalSmartAccountsConnection(
  config: LoyalSmartAccountsConnectionConfig
): Connection {
  if (config.connection) {
    return config.connection;
  }

  const commitment = config.commitment ?? DEFAULT_COMMITMENT;
  const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(config.env);

  if (!config.cache) {
    return config.createConnection
      ? config.createConnection(rpcEndpoint, websocketEndpoint, commitment)
      : new Connection(rpcEndpoint, {
          commitment,
          wsEndpoint: websocketEndpoint,
        });
  }

  const cacheKey = getCacheKey(rpcEndpoint, websocketEndpoint, commitment);
  const cached = config.cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const connection = config.createConnection
    ? config.createConnection(rpcEndpoint, websocketEndpoint, commitment)
    : new Connection(rpcEndpoint, {
        commitment,
        wsEndpoint: websocketEndpoint,
      });

  config.cache.set(cacheKey, connection);
  return connection;
}

export function resolveLoyalSmartAccountsClientConfigFromEnv(
  config: ResolveLoyalSmartAccountsClientConfigFromEnvInput
): LoyalSmartAccountsClientConfig {
  const commitment = config.commitment ?? DEFAULT_COMMITMENT;

  return {
    connection: getLoyalSmartAccountsConnection({
      env: config.env,
      commitment,
      connection: config.connection,
      createConnection: config.createConnection,
      cache: config.cache,
    }),
    programId: config.programId,
    defaultCommitment: commitment,
    sendPrepared: config.sendPrepared,
    confirm: config.confirm,
  };
}
