import "server-only";

import {
  isLoyalTokenTickerData,
  LOYAL_TOKEN_MINT,
  type LoyalTokenTickerData,
} from "@/lib/market/loyal-token-ticker.shared";

const JUPITER_TOKEN_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
const UPSTREAM_TIMEOUT_MS = 5000;
const SERVER_FRESH_MS = 5 * 60 * 1000;
const SERVER_STALE_MS = 24 * 60 * 60 * 1000;

export const LOYAL_TICKER_RESPONSE_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400";

type CacheEntry = {
  freshUntil: number;
  staleUntil: number;
  value: LoyalTokenTickerData;
};

let cache: CacheEntry | null = null;
let inflight: Promise<LoyalTokenTickerData> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUsdPrice(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number.parseFloat(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseJupiterToken(payload: unknown): LoyalTokenTickerData | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  for (const value of payload) {
    if (!isRecord(value)) {
      continue;
    }

    const mint = value.id ?? value.address;
    if (mint !== LOYAL_TOKEN_MINT) {
      continue;
    }

    const data = {
      symbol: value.symbol,
      icon: value.icon,
      usdPrice: parseUsdPrice(value.usdPrice),
    };
    if (isLoyalTokenTickerData(data)) {
      return data;
    }
  }

  return null;
}

async function fetchFromJupiter(): Promise<LoyalTokenTickerData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const url = new URL(JUPITER_TOKEN_SEARCH_URL);
  url.searchParams.set("query", LOYAL_TOKEN_MINT);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: SERVER_FRESH_MS / 1000 },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Jupiter token request failed with ${response.status}`);
    }

    const payload: unknown = await response.json();
    const token = parseJupiterToken(payload);
    if (!token) {
      throw new Error("Jupiter returned invalid LOYAL ticker data");
    }

    return token;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function readLoyalTokenTicker(): Promise<LoyalTokenTickerData> {
  const now = Date.now();
  if (cache && cache.freshUntil > now) {
    return cache.value;
  }
  if (inflight) {
    return inflight;
  }

  const stale = cache && cache.staleUntil > now ? cache.value : null;
  const request = fetchFromJupiter()
    .then((value) => {
      const savedAt = Date.now();
      cache = {
        freshUntil: savedAt + SERVER_FRESH_MS,
        staleUntil: savedAt + SERVER_STALE_MS,
        value,
      };
      return value;
    })
    .catch((error: unknown) => {
      if (stale) {
        return stale;
      }
      throw error;
    })
    .finally(() => {
      if (inflight === request) {
        inflight = null;
      }
    });

  inflight = request;
  return request;
}
