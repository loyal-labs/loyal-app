"use client";

import type { SwapToken } from "@loyal-labs/wallet-core/types";

import {
  readClientCacheEntry,
  writeClientCache,
} from "@/lib/client-cache/client-cache";

/**
 * Jupiter search hit enriched with the display/quality fields the shared
 * `SwapToken` type drops. Still assignable to `SwapToken`, so token pickers
 * that only read mint/symbol/icon/price keep working unchanged.
 */
export type TokenSearchResult = Omit<SwapToken, "mint"> & {
  /** Jupiter always returns a mint (`id`) for search hits, so this is required. */
  mint: string;
  name: string;
  isVerified: boolean;
  mcap: number | null;
};

const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
const JUPITER_SEARCH_LIMIT = 10;
// Typeahead requests are user-perceived latency; past this the user has already
// kept typing, so the result would be discarded anyway.
const SEARCH_TIMEOUT_MS = 8 * 1000;
const SEARCH_CACHE_LIMIT = 50;
const SEARCH_FRESH_MS = 5 * 60 * 1000;

type JupiterSearchResult = {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string | null;
  usdPrice: number | null;
  isVerified: boolean;
  mcap: number | null;
};

function toTokenSearchResult(t: JupiterSearchResult): TokenSearchResult {
  return {
    mint: t.id,
    symbol: t.symbol,
    name: t.name,
    icon: t.icon ?? "",
    price: t.usdPrice ?? 0,
    balance: 0,
    isVerified: t.isVerified,
    mcap: t.mcap,
  };
}

function isJupiterSearchResultArray(
  data: unknown
): data is JupiterSearchResult[] {
  return (
    Array.isArray(data) &&
    data.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as JupiterSearchResult).id === "string" &&
        typeof (t as JupiterSearchResult).symbol === "string" &&
        typeof (t as JupiterSearchResult).isVerified === "boolean"
    )
  );
}

function composeRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Rejects as soon as `signal` aborts, even when `promise` is shared with other
 * callers (in-flight dedup) and therefore outlives this one.
 */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function fetchJupiterSearch(
  query: string,
  signal?: AbortSignal
): Promise<TokenSearchResult[]> {
  const res = await fetch(
    `${JUPITER_SEARCH_URL}?query=${encodeURIComponent(
      query
    )}&tags=verified&limit=${JUPITER_SEARCH_LIMIT}`,
    { signal: composeRequestSignal(signal) }
  );
  if (!res.ok) throw new Error(`Token search failed: ${res.status}`);
  const data: unknown = await res.json();
  if (!isJupiterSearchResultArray(data)) return [];
  return data.map(toTokenSearchResult);
}

// LRU keyed by normalized query. Insertion order doubles as recency, so
// re-inserting on read keeps hot queries at the tail for eviction.
let searchCache = new Map<
  string,
  { expiresAt: number; value: TokenSearchResult[] }
>();
let searchInflight = new Map<string, Promise<TokenSearchResult[]>>();

function setSearchCacheEntry(key: string, value: TokenSearchResult[]) {
  searchCache.delete(key);
  searchCache.set(key, {
    expiresAt: Date.now() + SEARCH_FRESH_MS,
    value,
  });
  while (searchCache.size > SEARCH_CACHE_LIMIT) {
    const oldest = searchCache.keys().next();
    if (oldest.done) break;
    searchCache.delete(oldest.value);
  }
}

/**
 * Searches verified Jupiter tokens for a free-text query.
 *
 * Results are returned in Jupiter's own relevance order; use
 * `rankSearchResults` when a caller needs deterministic tiering.
 *
 * The first caller's signal is the one wired into the fetch, so an abort
 * genuinely cancels the in-flight request. Late joiners share that request and
 * observe the same cancellation — acceptable for typeahead, where a superseded
 * query is exactly the one being abandoned. An aborted or failed request is
 * never cached, so the next call starts clean.
 */
export async function searchTokens(
  query: string,
  signal?: AbortSignal
): Promise<TokenSearchResult[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];

  const now = Date.now();
  const cached = searchCache.get(key);
  if (cached) {
    searchCache.delete(key);
    if (cached.expiresAt > now) {
      searchCache.set(key, cached);
      return cached.value;
    }
  }

  const existing = searchInflight.get(key);
  if (existing) return withAbort(existing, signal);

  // Written once per request on the shared promise, so a rejected (aborted or
  // failed) request never reaches the cache.
  // Fetch with the raw (case-preserved) query: base58 mint addresses are
  // case-sensitive, so lowercasing here would break paste-a-mint search.
  const request = fetchJupiterSearch(query.trim(), signal)
    .then((value) => {
      setSearchCacheEntry(key, value);
      return value;
    })
    .finally(() => {
      searchInflight.delete(key);
    });
  searchInflight.set(key, request);
  return withAbort(request, signal);
}

const TRENDING_TOKENS_CACHE_VERSION = 2;
// Jupiter's verified-token registry is mainnet data regardless of the
// selected Solana cluster, so the persisted cache is env-independent.
const TRENDING_TOKENS_CACHE_SCOPE = "global";
// v2 widens the stored shape from `SwapToken` to `TokenSearchResult`.
const TRENDING_TOKENS_CACHE_KEY = `loyal.popularTokens.v${TRENDING_TOKENS_CACHE_VERSION}`;
// Token identity (mint/symbol/icon/decimals) is effectively immutable; the
// price field is only indicative in pickers (quotes come from the Jupiter
// quote API), so serving a stale list is safe.
const TRENDING_TOKENS_FRESH_MS = 60 * 60 * 1000;
const TRENDING_TOKENS_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

const TRENDING_SYMBOLS = [
  "USDC",
  "USDT",
  "JUP",
  "BONK",
  "RAY",
  "WIF",
  "PYTH",
  "JTO",
  "ORCA",
  "RENDER",
];

function isTokenSearchResultArray(data: unknown): data is TokenSearchResult[] {
  return (
    Array.isArray(data) &&
    data.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as TokenSearchResult).mint === "string" &&
        typeof (t as TokenSearchResult).symbol === "string" &&
        typeof (t as TokenSearchResult).name === "string" &&
        typeof (t as TokenSearchResult).icon === "string" &&
        typeof (t as TokenSearchResult).price === "number" &&
        typeof (t as TokenSearchResult).balance === "number" &&
        typeof (t as TokenSearchResult).isVerified === "boolean"
    )
  );
}

function readPersistedTrendingTokens() {
  return readClientCacheEntry<TokenSearchResult[]>({
    key: TRENDING_TOKENS_CACHE_KEY,
    version: TRENDING_TOKENS_CACHE_VERSION,
    solanaEnv: TRENDING_TOKENS_CACHE_SCOPE,
    validate: isTokenSearchResultArray,
  });
}

let trendingCache: TokenSearchResult[] | null = null;
let trendingInflight: Promise<TokenSearchResult[]> | null = null;

function loadTrendingTokensFromNetwork(): Promise<TokenSearchResult[]> {
  if (trendingInflight) return trendingInflight;

  trendingInflight = Promise.all(
    TRENDING_SYMBOLS.map(async (symbol) => {
      try {
        const tokens = await fetchJupiterSearch(symbol);
        // Pick exact symbol match with highest mcap
        const exact = tokens
          .filter(
            (t) =>
              t.symbol.toUpperCase() === symbol.toUpperCase() && t.isVerified
          )
          .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
        return exact[0] ?? null;
      } catch {
        return null;
      }
    })
  )
    .then((results) => {
      trendingCache = results.filter((t): t is TokenSearchResult => t !== null);
      // Only persist complete lists so a partial outage never pins a
      // degraded picker for the full TTL.
      if (trendingCache.length === TRENDING_SYMBOLS.length) {
        writeClientCache({
          key: TRENDING_TOKENS_CACHE_KEY,
          version: TRENDING_TOKENS_CACHE_VERSION,
          solanaEnv: TRENDING_TOKENS_CACHE_SCOPE,
          data: trendingCache,
          ttlMs: TRENDING_TOKENS_PERSIST_TTL_MS,
        });
      }
      return trendingCache;
    })
    .finally(() => {
      trendingInflight = null;
    });

  return trendingInflight;
}

/**
 * Warms the trending-token list. Safe to call repeatedly: concurrent calls
 * share one request, and a fresh cache or a persisted list is returned without
 * touching the network (a stale-but-valid list revalidates in the background).
 */
export async function prefetchTrendingTokens(): Promise<TokenSearchResult[]> {
  if (trendingCache) return trendingCache;
  if (trendingInflight) return trendingInflight;

  const persisted = readPersistedTrendingTokens();
  if (persisted) {
    trendingCache = persisted.data;
    if (Date.now() - persisted.savedAt >= TRENDING_TOKENS_FRESH_MS) {
      // Stale but usable: serve instantly and revalidate in the background
      // for the next consumer.
      void loadTrendingTokensFromNetwork().catch(() => {});
    }
    return trendingCache;
  }

  return loadTrendingTokensFromNetwork();
}

/**
 * Synchronous read of the trending list for instant paint (e.g. on input
 * focus). Reads memory first, then localStorage; never touches the network and
 * does not promote the persisted list into memory, so `prefetchTrendingTokens`
 * still sees the saved timestamp and can revalidate a stale list.
 */
export function getCachedTrendingTokens(): TokenSearchResult[] | null {
  if (trendingCache) return trendingCache;
  return readPersistedTrendingTokens()?.data ?? null;
}

/**
 * Orders results into tiers: exact symbol match, symbol prefix, name prefix,
 * exact mint match, then everything else. Within a tier, higher mcap wins.
 * Mint matching uses the raw (case-sensitive) query because base58 addresses
 * are case-sensitive; symbol/name matching is case-insensitive.
 *
 * `Array#sort` is stable, so equal mcap preserves the caller's order.
 */
export function rankSearchResults(
  query: string,
  results: TokenSearchResult[]
): TokenSearchResult[] {
  const symbol = query.trim().toLowerCase();
  const name = symbol;
  const mint = query.trim();

  const tier = (t: TokenSearchResult) => {
    if (t.symbol.toLowerCase() === symbol) return 0;
    if (t.symbol.toLowerCase().startsWith(symbol)) return 1;
    if (name && t.name.toLowerCase().startsWith(name)) return 2;
    if (mint && t.mint === mint) return 3;
    return 4;
  };

  return [...results].sort(
    (a, b) => tier(a) - tier(b) || (b.mcap ?? 0) - (a.mcap ?? 0)
  );
}

export function resetTokenSearchCacheForTests() {
  searchCache = new Map();
  searchInflight = new Map();
  trendingCache = null;
  trendingInflight = null;
}
