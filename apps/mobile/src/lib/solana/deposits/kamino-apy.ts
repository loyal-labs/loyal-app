import { LoyalPrivateTransactionsClient } from "@loyal-labs/private-transactions";
import type { LoyalPrivateTransactionsClient as LoyalPrivateTransactionsClientType } from "@loyal-labs/private-transactions";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  getEndpoints,
  getPerEndpoints,
  getSolanaEnv,
} from "@/lib/solana/rpc/connection";
import type { SolanaEnv } from "@/lib/solana/rpc/types";

const APY_TTL_MS = 5 * 60 * 1000;
const APY_FAILURE_TTL_MS = 30 * 1000;

type ApyCacheEntry = {
  expiresAt: number;
  apyBps: number | null;
};

const apyCache = new Map<string, ApyCacheEntry>();
const apyInflight = new Map<string, Promise<number | null>>();

const clients = new Map<SolanaEnv, LoyalPrivateTransactionsClientType>();
const clientPromises = new Map<
  SolanaEnv,
  Promise<LoyalPrivateTransactionsClientType>
>();

function getReadOnlyClient(
  solanaEnv: SolanaEnv,
): Promise<LoyalPrivateTransactionsClientType> {
  const cached = clients.get(solanaEnv);
  if (cached) return Promise.resolve(cached);

  const pending = clientPromises.get(solanaEnv);
  if (pending) return pending;

  const promise = (async () => {
    const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
    const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer: Keypair.generate(),
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      ephemeralRpcEndpoint: perRpcEndpoint,
      ephemeralWsEndpoint: perWsEndpoint,
      // Read-only client: getKaminoLendingApyBps hits Kamino's public API,
      // never PER. Pass a sentinel token so fromConfig skips its internal
      // Ed25519-JWK auth dance, which RN's partial crypto.subtle can't
      // perform (no importKey).
      authToken: { token: "read-only", expiresAt: Number.MAX_SAFE_INTEGER },
    });
    clients.set(solanaEnv, client);
    clientPromises.delete(solanaEnv);
    return client;
  })().catch((error) => {
    clientPromises.delete(solanaEnv);
    throw error;
  });

  clientPromises.set(solanaEnv, promise);
  return promise;
}

export function clearKaminoApyCache(): void {
  apyCache.clear();
  apyInflight.clear();
  clients.clear();
  clientPromises.clear();
}

export async function getCachedKaminoLendingApyBps(
  mint: string,
): Promise<number | null> {
  const solanaEnv = getSolanaEnv();
  const key = `${solanaEnv}:${mint}`;
  const now = Date.now();

  const entry = apyCache.get(key);
  if (entry && entry.expiresAt > now) return entry.apyBps;

  const inflight = apyInflight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const client = await getReadOnlyClient(solanaEnv);
      const apyBps = await client.getKaminoLendingApyBps(new PublicKey(mint));
      apyCache.set(key, {
        expiresAt: Date.now() + APY_TTL_MS,
        apyBps,
      });
      return apyBps;
    } catch (error) {
      apyCache.set(key, {
        expiresAt: Date.now() + APY_FAILURE_TTL_MS,
        apyBps: null,
      });
      console.warn("[kamino-apy] getKaminoLendingApyBps failed", error);
      return null;
    } finally {
      apyInflight.delete(key);
    }
  })();

  apyInflight.set(key, promise);
  return promise;
}
