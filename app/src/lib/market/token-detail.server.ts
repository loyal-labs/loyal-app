import "server-only";

import { fetchTokenMetricsByMint } from "@/lib/jupiter/tokens-v2.server";
import {
  fetchBirdeyePriceHistory,
  fetchBirdeyeTokenMarketData,
  fetchBirdeyeTokenMetadata,
} from "@/lib/market/birdeye.server";

const TOKEN_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export type MobileTokenDetailChartPoint = {
  timestamp: number;
  priceUsd: number;
};

export type MobileTokenDetailResponse = {
  mint: string;
  token: {
    decimals: number | null;
    logoUrl: string | null;
    name: string | null;
    symbol: string | null;
  };
  links: {
    website: string | null;
    twitter: string | null;
    explorer: string | null;
  };
  market: {
    fdvUsd: number | null;
    holderCount: number | null;
    liquidityUsd: number | null;
    marketCapUsd: number | null;
    priceChange24hPercent: number | null;
    priceUsd: number | null;
    updatedAt: string | null;
    volume24hUsd: number | null;
  };
  chart: MobileTokenDetailChartPoint[];
};

type TokenDetailCacheEntry = {
  expiresAt: number;
  value: MobileTokenDetailResponse;
};

const tokenDetailCache = new Map<string, TokenDetailCacheEntry>();
const tokenDetailInflight = new Map<string, Promise<MobileTokenDetailResponse>>();

async function getSettledValue<T>(
  promise: Promise<T>
): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function getCachedTokenDetail(mint: string): MobileTokenDetailResponse | null {
  const cached = tokenDetailCache.get(mint);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    tokenDetailCache.delete(mint);
    return null;
  }

  return cached.value;
}

function canCacheTokenDetail(detail: MobileTokenDetailResponse): boolean {
  return (
    (typeof detail.market.priceChange24hPercent === "number" &&
      Number.isFinite(detail.market.priceChange24hPercent)) ||
    detail.chart.length >= 2
  );
}

function setCachedTokenDetail(detail: MobileTokenDetailResponse): MobileTokenDetailResponse {
  if (!canCacheTokenDetail(detail)) {
    return detail;
  }

  tokenDetailCache.set(detail.mint, {
    expiresAt: Date.now() + TOKEN_DETAIL_CACHE_TTL_MS,
    value: detail,
  });

  return detail;
}

export async function fetchTokenDetailByMint(
  mint: string
): Promise<MobileTokenDetailResponse> {
  const cached = getCachedTokenDetail(mint);
  if (cached) {
    return cached;
  }

  const inflight = tokenDetailInflight.get(mint);
  if (inflight) {
    return inflight;
  }

  const request = Promise.all([
    getSettledValue(fetchTokenMetricsByMint(mint)),
    getSettledValue(fetchBirdeyeTokenMarketData(mint)),
    getSettledValue(fetchBirdeyeTokenMetadata(mint)),
    getSettledValue(fetchBirdeyePriceHistory(mint)),
  ])
    .then(([jupiterMetrics, marketData, metadata, chart]) =>
      setCachedTokenDetail({
        mint,
        token: {
          decimals: metadata?.decimals ?? null,
          logoUrl: metadata?.logoUrl ?? null,
          name: metadata?.name ?? null,
          symbol: metadata?.symbol ?? null,
        },
        links: {
          explorer: `https://solscan.io/token/${mint}`,
          twitter: metadata?.twitter ?? null,
          website: metadata?.website ?? null,
        },
        market: {
          fdvUsd:
            marketData?.fullyDilutedValueUsd ?? jupiterMetrics?.fdvUsd ?? null,
          holderCount: jupiterMetrics?.holderCount ?? null,
          liquidityUsd:
            marketData?.liquidityUsd ?? jupiterMetrics?.liquidityUsd ?? null,
          marketCapUsd:
            marketData?.marketCapUsd ?? jupiterMetrics?.marketCapUsd ?? null,
          priceChange24hPercent: marketData?.priceChange24hPercent ?? null,
          priceUsd: marketData?.priceUsd ?? jupiterMetrics?.priceUsd ?? null,
          updatedAt: jupiterMetrics?.updatedAt ?? null,
          volume24hUsd: marketData?.volume24hUsd ?? null,
        },
        chart: chart ?? [],
      })
    )
    .finally(() => {
      tokenDetailInflight.delete(mint);
    });

  tokenDetailInflight.set(mint, request);
  return request;
}
