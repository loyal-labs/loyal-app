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

export async function fetchTokenDetailByMint(
  mint: string
): Promise<MobileTokenDetailResponse> {
  const [jupiterMetrics, marketData, metadata, chart] = await Promise.all([
    fetchTokenMetricsByMint(mint),
    fetchBirdeyeTokenMarketData(mint),
    fetchBirdeyeTokenMetadata(mint),
    fetchBirdeyePriceHistory(mint),
  ]);

  return {
    mint,
    token: {
      decimals: metadata.decimals,
      logoUrl: metadata.logoUrl,
      name: metadata.name,
      symbol: metadata.symbol,
    },
    market: {
      fdvUsd: marketData.fullyDilutedValueUsd ?? jupiterMetrics.fdvUsd ?? null,
      holderCount: jupiterMetrics.holderCount ?? null,
      liquidityUsd: marketData.liquidityUsd ?? jupiterMetrics.liquidityUsd ?? null,
      marketCapUsd: marketData.marketCapUsd ?? jupiterMetrics.marketCapUsd ?? null,
      priceChange24hPercent: marketData.priceChange24hPercent,
      priceUsd: marketData.priceUsd ?? jupiterMetrics.priceUsd ?? null,
      updatedAt: jupiterMetrics.updatedAt ?? null,
      volume24hUsd: marketData.volume24hUsd,
    },
    chart,
  };
}
