import "server-only";

import { serverEnv } from "../core/config/server";
import { fetchJson } from "../core/http";

const COINGECKO_BASE_URL = "https://pro-api.coingecko.com/api/v3";
const SOLANA_NETWORK = "solana";
const SOLANA_POOL_PREFIX = "solana_";

export type CoinGeckoTokenData = {
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  decimals: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volumeUsd24h: number | null;
  totalReserveUsd: number | null;
  coingeckoCoinId: string | null;
  topPoolIds: string[];
};

export type CoinGeckoTokenInfo = {
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
};

export type CoinGeckoChartPoint = {
  timestamp: number;
  priceUsd: number;
};

export type CoinGeckoChartResult = {
  points: CoinGeckoChartPoint[];
  volumeUsd24h: number | null;
};

type OnchainTokenResponse = {
  data?: {
    attributes?: {
      name?: string;
      symbol?: string;
      decimals?: number;
      image_url?: string | null;
      price_usd?: string | number | null;
      market_cap_usd?: string | number | null;
      fdv_usd?: string | number | null;
      volume_usd?: { h24?: string | number | null } | null;
      total_reserve_in_usd?: string | number | null;
      coingecko_coin_id?: string | null;
    };
    relationships?: {
      top_pools?: { data?: { id: string }[] };
    };
  };
};

type OnchainTokenInfoResponse = {
  data?: {
    attributes?: {
      websites?: string[];
      twitter_handle?: string | null;
      discord_url?: string | null;
      telegram_handle?: string | null;
      description?: string | null;
      gt_score?: number | null;
      gt_verified?: boolean | null;
      holders?: {
        count?: number | null;
        distribution_percentage?: {
          top_10?: string | null;
          rest?: string | null;
        } | null;
      } | null;
      mint_authority?: string | null;
      freeze_authority?: string | null;
    };
  };
};

type CoinMarketChartResponse = {
  prices?: [number, number][];
  total_volumes?: [number, number][];
};

type PoolOhlcvResponse = {
  data?: {
    attributes?: {
      ohlcv_list?: number[][];
    };
  };
};

function getHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-cg-pro-api-key": serverEnv.coingeckoApiKey,
  };
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function stripSolanaPrefix(poolId: string): string {
  return poolId.startsWith(SOLANA_POOL_PREFIX)
    ? poolId.slice(SOLANA_POOL_PREFIX.length)
    : poolId;
}

export async function fetchCoinGeckoTokenData(
  mint: string
): Promise<CoinGeckoTokenData> {
  const response = await fetchJson<OnchainTokenResponse>(
    `${COINGECKO_BASE_URL}/onchain/networks/${SOLANA_NETWORK}/tokens/${mint}`,
    { method: "GET", headers: getHeaders() }
  );

  const attrs = response.data?.attributes ?? {};
  const topPools = response.data?.relationships?.top_pools?.data ?? [];

  return {
    name: attrs.name ?? null,
    symbol: attrs.symbol ?? null,
    imageUrl: attrs.image_url ?? null,
    decimals: typeof attrs.decimals === "number" ? attrs.decimals : null,
    priceUsd: parseNumber(attrs.price_usd),
    marketCapUsd: parseNumber(attrs.market_cap_usd),
    fdvUsd: parseNumber(attrs.fdv_usd),
    volumeUsd24h: parseNumber(attrs.volume_usd?.h24),
    totalReserveUsd: parseNumber(attrs.total_reserve_in_usd),
    coingeckoCoinId: attrs.coingecko_coin_id ?? null,
    topPoolIds: topPools.map((pool) => stripSolanaPrefix(pool.id)),
  };
}

export async function fetchCoinGeckoTokenInfo(
  mint: string
): Promise<CoinGeckoTokenInfo> {
  const response = await fetchJson<OnchainTokenInfoResponse>(
    `${COINGECKO_BASE_URL}/onchain/networks/${SOLANA_NETWORK}/tokens/${mint}/info`,
    { method: "GET", headers: getHeaders() }
  );

  const attrs = response.data?.attributes ?? {};
  const distribution = attrs.holders?.distribution_percentage;

  return {
    websites: attrs.websites ?? [],
    twitterHandle: attrs.twitter_handle ?? null,
    discordUrl: attrs.discord_url ?? null,
    telegramHandle: attrs.telegram_handle ?? null,
    description: attrs.description?.trim() ? attrs.description.trim() : null,
    gtScore: parseNumber(attrs.gt_score),
    gtVerified: attrs.gt_verified === true,
    holderCount:
      typeof attrs.holders?.count === "number" ? attrs.holders.count : null,
    holderDistribution:
      distribution?.top_10 != null && distribution?.rest != null
        ? { top10: distribution.top_10, rest: distribution.rest }
        : null,
    mintAuthority: attrs.mint_authority ?? null,
    freezeAuthority: attrs.freeze_authority ?? null,
  };
}

export async function fetchCoinGeckoCoinChart(
  coingeckoCoinId: string
): Promise<CoinGeckoChartResult> {
  const response = await fetchJson<CoinMarketChartResponse>(
    `${COINGECKO_BASE_URL}/coins/${coingeckoCoinId}/market_chart?vs_currency=usd&days=1`,
    { method: "GET", headers: getHeaders() }
  );

  const points = (response.prices ?? []).map(([timestamp, priceUsd]) => ({
    timestamp,
    priceUsd,
  }));
  const volumes = response.total_volumes;
  const volumeUsd24h =
    volumes && volumes.length > 0 ? volumes[volumes.length - 1][1] : null;

  return { points, volumeUsd24h };
}

export async function fetchCoinGeckoPoolOhlcv(
  poolId: string
): Promise<CoinGeckoChartPoint[]> {
  const response = await fetchJson<PoolOhlcvResponse>(
    `${COINGECKO_BASE_URL}/onchain/networks/${SOLANA_NETWORK}/pools/${poolId}/ohlcv/hour`,
    { method: "GET", headers: getHeaders() }
  );

  const ohlcvList = response.data?.attributes?.ohlcv_list ?? [];

  // OHLCV tuples: [timestamp, open, high, low, close, volume].
  return ohlcvList
    .filter(
      (candle): candle is number[] =>
        Array.isArray(candle) && candle.length >= 5
    )
    .map((candle) => ({ timestamp: candle[0], priceUsd: candle[4] }));
}
