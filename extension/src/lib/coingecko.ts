const BASE_URL = "https://pro-api.coingecko.com/api/v3";

function getHeaders(): HeadersInit {
  const apiKey = import.meta.env.VITE_COINGECKO_API_KEY;
  return apiKey ? { "x-cg-pro-api-key": apiKey } : {};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoinGeckoTokenData {
  name: string;
  symbol: string;
  imageUrl: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volumeUsd24h: number | null;
  totalReserveUsd: number | null;
  coingeckoCoinId: string | null;
  topPoolIds: string[];
}

export interface CoinGeckoTokenInfo {
  websites: string[];
  twitterHandle: string | null;
  discordUrl: string | null;
  telegramHandle: string | null;
  description: string | null;
  gtScore: number | null;
  gtVerified: boolean;
  holderCount: number | null;
  holderDistribution: {
    top10: string;
    rest: string;
  } | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface CoinGeckoChartPoint {
  timestamp: number;
  price: number;
}

export interface TokenDetailData {
  token: CoinGeckoTokenData;
  info: CoinGeckoTokenInfo;
  chart: CoinGeckoChartPoint[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

function stripSolanaPrefix(poolId: string): string {
  return poolId.startsWith("solana_") ? poolId.slice("solana_".length) : poolId;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchTokenData(
  mint: string,
): Promise<CoinGeckoTokenData> {
  const res = await fetch(
    `${BASE_URL}/onchain/networks/solana/tokens/${mint}`,
    { headers: getHeaders() },
  );
  if (!res.ok) {
    throw new Error(`fetchTokenData failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const attrs = json.data.attributes;
  const rels = json.data.relationships ?? {};

  const topPools: string[] = (rels.top_pools?.data ?? []).map(
    (p: { id: string; type: string }) => stripSolanaPrefix(p.id),
  );

  return {
    name: attrs.name,
    symbol: attrs.symbol,
    imageUrl: attrs.image_url ?? null,
    priceUsd: parseNumber(attrs.price_usd),
    marketCapUsd: parseNumber(attrs.market_cap_usd),
    fdvUsd: parseNumber(attrs.fdv_usd),
    volumeUsd24h: parseNumber(attrs.volume_usd?.h24),
    totalReserveUsd: parseNumber(attrs.total_reserve_in_usd),
    coingeckoCoinId: attrs.coingecko_coin_id ?? null,
    topPoolIds: topPools,
  };
}

export async function fetchTokenInfo(
  mint: string,
): Promise<CoinGeckoTokenInfo> {
  const res = await fetch(
    `${BASE_URL}/onchain/networks/solana/tokens/${mint}/info`,
    { headers: getHeaders() },
  );
  if (!res.ok) {
    throw new Error(`fetchTokenInfo failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const attrs = json.data.attributes;
  const holders = attrs.holders;

  return {
    websites: attrs.websites ?? [],
    twitterHandle: attrs.twitter_handle ?? null,
    discordUrl: attrs.discord_url ?? null,
    telegramHandle: attrs.telegram_handle ?? null,
    description: attrs.description || null,
    gtScore: parseNumber(attrs.gt_score),
    gtVerified: attrs.gt_verified ?? false,
    holderCount: holders?.count ?? null,
    holderDistribution: holders?.distribution_percentage
      ? {
          top10: holders.distribution_percentage.top_10,
          rest: holders.distribution_percentage.rest,
        }
      : null,
    mintAuthority: attrs.mint_authority ?? null,
    freezeAuthority: attrs.freeze_authority ?? null,
  };
}

interface ChartResult {
  points: CoinGeckoChartPoint[];
  volume24h: number | null;
}

export async function fetchChart(
  coingeckoCoinId: string,
): Promise<ChartResult> {
  const res = await fetch(
    `${BASE_URL}/coins/${coingeckoCoinId}/market_chart?vs_currency=usd&days=1`,
    { headers: getHeaders() },
  );
  if (!res.ok) {
    throw new Error(`fetchChart failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const points = (json.prices as [number, number][]).map(([timestamp, price]) => ({
    timestamp,
    price,
  }));

  const volumes = json.total_volumes as [number, number][] | undefined;
  const volume24h = volumes?.length ? volumes[volumes.length - 1][1] : null;

  return { points, volume24h };
}

export async function fetchPoolOhlcv(
  poolId: string,
): Promise<CoinGeckoChartPoint[]> {
  const res = await fetch(
    `${BASE_URL}/onchain/networks/solana/pools/${poolId}/ohlcv/hour`,
    { headers: getHeaders() },
  );
  if (!res.ok) {
    throw new Error(`fetchPoolOhlcv failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const ohlcvList = json.data.attributes.ohlcv_list as number[][];

  return ohlcvList.map((candle) => ({
    timestamp: candle[0],
    price: candle[4], // close price
  }));
}

export async function fetchPriceChanges(
  mints: string[],
): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const res = await fetch(
    `${BASE_URL}/simple/token_price/solana?contract_addresses=${mints.join(",")}&vs_currencies=usd&include_24hr_change=true`,
    { headers: getHeaders() },
  );
  if (!res.ok) return {};
  const json = await res.json() as Record<string, { usd_24h_change?: number }>;
  const result: Record<string, number> = {};
  for (const [mint, data] of Object.entries(json)) {
    if (typeof data.usd_24h_change === "number") {
      result[mint] = data.usd_24h_change;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cache (5-minute TTL, in-memory)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: TokenDetailData; expiresAt: number }>();
const inflight = new Map<string, Promise<TokenDetailData>>();

export async function fetchTokenDetail(
  mint: string,
): Promise<TokenDetailData> {
  const cached = cache.get(mint);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = inflight.get(mint);
  if (existing) return existing;

  const promise = fetchTokenDetailUncached(mint).then((data) => {
    cache.set(mint, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    inflight.delete(mint);
    return data;
  }).catch((err) => {
    inflight.delete(mint);
    throw err;
  });

  inflight.set(mint, promise);
  return promise;
}

async function fetchTokenDetailUncached(
  mint: string,
): Promise<TokenDetailData> {
  const [token, info] = await Promise.all([
    fetchTokenData(mint),
    fetchTokenInfo(mint),
  ]);

  let chart: CoinGeckoChartPoint[] = [];
  try {
    if (token.coingeckoCoinId) {
      const result = await fetchChart(token.coingeckoCoinId);
      chart = result.points;
      // Prefer aggregated volume from main API over onchain pool volume
      if (result.volume24h !== null) {
        token.volumeUsd24h = result.volume24h;
      }
    } else if (token.topPoolIds.length > 0) {
      chart = await fetchPoolOhlcv(token.topPoolIds[0]);
    }
  } catch {
    // Chart data is best-effort; don't fail the entire detail fetch
  }

  return { token, info, chart };
}
