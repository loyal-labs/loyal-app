import "server-only";

import { fetchTokenMetricsByMint } from "@/lib/jupiter/tokens-v2.server";
import {
  fetchBirdeyePriceHistory,
  fetchBirdeyeTokenMarketData,
  fetchBirdeyeTokenMetadata,
} from "@/lib/market/birdeye.server";

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

async function getSettledValue<T>(
  promise: Promise<T>
): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

export async function fetchTokenDetailByMint(
  mint: string
): Promise<MobileTokenDetailResponse> {
  const [jupiterMetrics, marketData, metadata, chart] = await Promise.all([
    getSettledValue(fetchTokenMetricsByMint(mint)),
    getSettledValue(fetchBirdeyeTokenMarketData(mint)),
    getSettledValue(fetchBirdeyeTokenMetadata(mint)),
    getSettledValue(fetchBirdeyePriceHistory(mint)),
  ]);

  return {
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
  };
}
