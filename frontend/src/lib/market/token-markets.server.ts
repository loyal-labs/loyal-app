import "server-only";

const COINGECKO_BASE_URL = "https://pro-api.coingecko.com/api/v3";
const SOLANA_NETWORK = "solana";
const TOKEN_MARKETS_CACHE_TTL_MS = 60 * 1000;
const MAX_MINTS_PER_CALL = 30;

export type TokenMarket = {
  mint: string;
  priceUsd: number | null;
  priceChange24hPercent: number | null;
};

type TokenMarketsResponse = {
  data?: {
    attributes?: {
      token_prices?: Record<string, string | number | null | undefined>;
      h24_price_change_percentage?: Record<
        string,
        string | number | null | undefined
      >;
    };
  };
};

type CacheEntry = {
  expiresAt: number;
  value: TokenMarket;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<TokenMarket[]>>();

function getCoinGeckoApiKey(): string | null {
  return (
    process.env.NEXT_COINGECKO_API_KEY ?? process.env.COINGECKO_API_KEY ?? null
  );
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchTokenMarketsBatch(mints: string[]): Promise<TokenMarket[]> {
  const apiKey = getCoinGeckoApiKey();
  if (!apiKey) {
    return mints.map((mint) => ({
      mint,
      priceUsd: null,
      priceChange24hPercent: null,
    }));
  }

  const path = `/onchain/simple/networks/${SOLANA_NETWORK}/token_price/${mints.join(
    ","
  )}?include_24hr_price_change=true`;
  const response = await fetch(`${COINGECKO_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "x-cg-pro-api-key": apiKey,
    },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(
      `CoinGecko token markets request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TokenMarketsResponse;
  const prices = payload.data?.attributes?.token_prices ?? {};
  const changes = payload.data?.attributes?.h24_price_change_percentage ?? {};

  return mints.map((mint) => ({
    mint,
    priceUsd: parseNumber(prices[mint]),
    priceChange24hPercent: parseNumber(changes[mint]),
  }));
}

export async function fetchTokenMarketsByMints(
  mints: string[]
): Promise<TokenMarket[]> {
  const normalized = Array.from(
    new Set(mints.map((mint) => mint.trim()).filter((mint) => mint.length > 0))
  );

  if (normalized.length === 0) {
    return [];
  }

  const now = Date.now();
  const fresh: TokenMarket[] = [];
  const stale: string[] = [];

  for (const mint of normalized) {
    const entry = cache.get(mint);
    if (entry && entry.expiresAt > now) {
      fresh.push(entry.value);
    } else {
      stale.push(mint);
    }
  }

  if (stale.length === 0) {
    return fresh;
  }

  const batches: string[][] = [];
  for (let index = 0; index < stale.length; index += MAX_MINTS_PER_CALL) {
    batches.push(stale.slice(index, index + MAX_MINTS_PER_CALL));
  }

  const fetched = (
    await Promise.all(
      batches.map((batch) => {
        const key = batch.join(",");
        const existing = inflight.get(key);
        if (existing) {
          return existing;
        }
        const promise = fetchTokenMarketsBatch(batch).finally(() => {
          if (inflight.get(key) === promise) {
            inflight.delete(key);
          }
        });
        inflight.set(key, promise);
        return promise;
      })
    )
  ).flat();

  const expiresAt = Date.now() + TOKEN_MARKETS_CACHE_TTL_MS;
  for (const market of fetched) {
    cache.set(market.mint, { expiresAt, value: market });
  }

  return [...fresh, ...fetched];
}
