import {
  type KaminoShieldedBalanceQuote,
  LoyalPrivateTransactionsClient,
} from "@loyal-labs/private-transactions";
import { getSolanaEndpoints, type SolanaEnv } from "@loyal-labs/solana-rpc";
import { Keypair, PublicKey } from "@solana/web3.js";

/**
 * Build a read-only LoyalPrivateTransactionsClient for Kamino reserve queries
 * (`getKaminoShieldedBalanceQuote`, `getKaminoLendingApyBps`). These methods
 * only read reserve state and don't need a real signer, so we use a throwaway
 * Keypair to satisfy the constructor.
 *
 * Safe because LoyalPrivateTransactionsClient.fromConfig only performs an
 * auth/PER handshake when `ephemeralRpcEndpoint` contains "tee" — by pointing
 * ephemeral at the base endpoint we avoid all RPC I/O during construction.
 * The read methods then only touch `baseProgram.provider.connection` (Kamino
 * reserve snapshot) and external HTTPS (Kamino metrics API).
 */
const clientPromises = new Map<
  SolanaEnv,
  Promise<LoyalPrivateTransactionsClient>
>();
const clients = new Map<SolanaEnv, LoyalPrivateTransactionsClient>();

export function getKaminoReadClient(
  solanaEnv: SolanaEnv
): Promise<LoyalPrivateTransactionsClient> {
  const cached = clients.get(solanaEnv);
  if (cached) {
    return Promise.resolve(cached);
  }

  const pending = clientPromises.get(solanaEnv);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
    const throwawaySigner = Keypair.generate();

    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer: throwawaySigner,
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      // Kamino read methods don't use the ephemeral RPC; point it at base.
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

// ---------------------------------------------------------------------------
// Per-mint caches
//
// Subscription-driven portfolio enrichment triggers a quote + APY fetch on
// every WebSocket tick. The underlying calls are expensive:
//   - getKaminoLendingApyBps hits api.kamino.finance (HTTPS)
//   - getKaminoShieldedBalanceQuote reads the Kamino reserve via RPC
//
// APY changes slowly, so cache with a 5 minute TTL keyed by (env, mint).
// The shielded quote depends on both reserve state and the user's share
// balance, so key it on (env, mint, sharesRaw) with a short 15 second TTL
// — enough to absorb rapid subscription ticks without masking real changes.
// ---------------------------------------------------------------------------

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
const quoteInflight = new Map<string, Promise<KaminoShieldedBalanceQuote | null>>();

function cacheKey(solanaEnv: SolanaEnv, mint: string): string {
  return `${solanaEnv}:${mint}`;
}

export async function getCachedKaminoLendingApyBps(args: {
  solanaEnv: SolanaEnv;
  mint: string;
}): Promise<number | null> {
  const { solanaEnv, mint } = args;
  const key = cacheKey(solanaEnv, mint);
  const now = Date.now();

  const entry = apyCache.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.apyBps;
  }

  const inflight = apyInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    try {
      const client = await getKaminoReadClient(solanaEnv);
      const apyBps = await client.getKaminoLendingApyBps(new PublicKey(mint));
      apyCache.set(key, { expiresAt: Date.now() + APY_TTL_MS, apyBps });
      return apyBps;
    } catch (error) {
      // On failure, cache a null for a shorter window so the next tick can
      // retry without constantly hammering the API.
      apyCache.set(key, {
        expiresAt: Date.now() + 30_000,
        apyBps: null,
      });
      console.warn("[kamino-read-client] getKaminoLendingApyBps failed", error);
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
  const key = cacheKey(solanaEnv, mint);
  const sharesKey = collateralSharesAmountRaw.toString();
  const now = Date.now();

  const entry = quoteCache.get(key);
  if (entry && entry.expiresAt > now && entry.sharesKey === sharesKey) {
    return entry.quote;
  }

  const inflightKey = `${key}:${sharesKey}`;
  const inflight = quoteInflight.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    try {
      const client = await getKaminoReadClient(solanaEnv);
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
      console.warn(
        "[kamino-read-client] getKaminoShieldedBalanceQuote failed",
        error
      );
      return null;
    } finally {
      quoteInflight.delete(inflightKey);
    }
  })();

  quoteInflight.set(inflightKey, promise);
  return promise;
}
