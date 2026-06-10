"use client";

export type TokenMarket = {
  mint: string;
  priceChange24hPercent: number | null;
};

export type TokenMarketsResponse = {
  markets: TokenMarket[];
};

const TOKEN_MARKETS_TTL_MS = 5 * 60 * 1000;

let cache = new Map<string, { expiresAt: number; value: TokenMarketsResponse }>();
let inflight = new Map<string, Promise<TokenMarketsResponse>>();

export function normalizeTokenMarketMintsSignature(mints: string) {
  return mints
    .split(",")
    .map((mint) => mint.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

export async function fetchTokenMarkets(
  mints: string,
  options: { now?: number } = {}
): Promise<TokenMarketsResponse> {
  const key = normalizeTokenMarketMintsSignature(mints);
  if (!key) {
    return { markets: [] };
  }

  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const url = new URL("/api/tokens/markets", window.location.origin);
    url.searchParams.set("mints", key);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Markets request failed: ${response.status}`);
    }

    const value = (await response.json()) as TokenMarketsResponse;
    cache.set(key, {
      expiresAt: Date.now() + TOKEN_MARKETS_TTL_MS,
      value,
    });
    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, request);
  return request;
}

export function resetTokenMarketsCacheForTests() {
  cache = new Map();
  inflight = new Map();
}
