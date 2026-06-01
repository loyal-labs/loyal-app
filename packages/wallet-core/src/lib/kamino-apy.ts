import {
  type KaminoShieldedBalanceQuote,
  LoyalPrivateTransactionsClient,
} from "@loyal-labs/private-transactions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { getSolanaEndpoints } from "@loyal-labs/solana-rpc";
import { Keypair, PublicKey } from "@solana/web3.js";

const APY_TTL_MS = 5 * 60 * 1000;
const QUOTE_TTL_MS = 15 * 1000;

type ApyCacheEntry = {
  expiresAt: number;
  apyBps: number | null;
};

type QuoteCacheEntry = {
  expiresAt: number;
  sharesKey: string;
  quote: KaminoShieldedBalanceQuote | null;
};

const apyCache = new Map<string, ApyCacheEntry>();
const apyInflight = new Map<string, Promise<number | null>>();
const quoteCache = new Map<string, QuoteCacheEntry>();
const quoteInflight = new Map<
  string,
  Promise<KaminoShieldedBalanceQuote | null>
>();

const clientPromises = new Map<
  SolanaEnv,
  Promise<LoyalPrivateTransactionsClient>
>();
const clients = new Map<SolanaEnv, LoyalPrivateTransactionsClient>();

function getReadOnlyClient(
  solanaEnv: SolanaEnv
): Promise<LoyalPrivateTransactionsClient> {
  const cached = clients.get(solanaEnv);
  if (cached) return Promise.resolve(cached);

  const pending = clientPromises.get(solanaEnv);
  if (pending) return pending;

  const promise = (async () => {
    const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer: Keypair.generate(),
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      ephemeralRpcEndpoint: rpcEndpoint,
      ephemeralWsEndpoint: websocketEndpoint,
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

export async function getCachedKaminoLendingApyBps(args: {
  solanaEnv: SolanaEnv;
  mint: string;
}): Promise<number | null> {
  const { solanaEnv, mint } = args;
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
      apyCache.set(key, { expiresAt: Date.now() + 30_000, apyBps: null });
      console.warn("[kamino-apy] getKaminoLendingApyBps failed", error);
      return null;
    } finally {
      apyInflight.delete(key);
    }
  })();

  apyInflight.set(key, promise);
  return promise;
}

export async function getCachedKaminoShieldedBalanceQuote(args: {
  solanaEnv: SolanaEnv;
  mint: string;
  collateralSharesAmountRaw: bigint;
}): Promise<KaminoShieldedBalanceQuote | null> {
  const { solanaEnv, mint, collateralSharesAmountRaw } = args;
  const key = `${solanaEnv}:${mint}`;
  const sharesKey = collateralSharesAmountRaw.toString();
  const now = Date.now();

  const entry = quoteCache.get(key);
  if (entry && entry.expiresAt > now && entry.sharesKey === sharesKey) {
    return entry.quote;
  }

  const inflightKey = `${key}:${sharesKey}`;
  const inflight = quoteInflight.get(inflightKey);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const client = await getReadOnlyClient(solanaEnv);
      const quote = await client.getKaminoShieldedBalanceQuote({
        tokenMint: new PublicKey(mint),
        collateralSharesAmountRaw,
      });
      quoteCache.set(key, {
        expiresAt: Date.now() + QUOTE_TTL_MS,
        sharesKey,
        quote,
      });
      return quote;
    } catch (error) {
      console.warn("[kamino-apy] getKaminoShieldedBalanceQuote failed", error);
      return null;
    } finally {
      quoteInflight.delete(inflightKey);
    }
  })();

  quoteInflight.set(inflightKey, promise);
  return promise;
}
