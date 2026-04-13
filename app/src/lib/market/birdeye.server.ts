import "server-only";

import { serverEnv } from "../core/config/server";
import { fetchJson } from "../core/http";

const BIRDEYE_BASE_URL = "https://public-api.birdeye.so";
const BIRDEYE_DEFAULT_HISTORY_INTERVAL = "1H";
const BIRDEYE_DEFAULT_HISTORY_HOURS = 24;

type BirdeyeEnvelope<T> = {
  data?: T;
  success?: boolean;
};

type BirdeyeHistoryPoint = {
  unixTime: number;
  value: number;
};

type BirdeyeHistoryResponse = {
  items?: BirdeyeHistoryPoint[];
};

type BirdeyeTokenMarketDataResponse = {
  fdv?: number;
  liquidity?: number;
  marketcap?: number;
  price?: number;
  price_change_24h_percent?: number;
  volume_24h_usd?: number;
};

type BirdeyeTokenMetadataResponse = {
  decimals?: number;
  logoURI?: string;
  name?: string;
  symbol?: string;
};

export type BirdeyePriceHistoryPoint = {
  timestamp: number;
  priceUsd: number;
};

export type BirdeyeTokenMarketData = {
  fullyDilutedValueUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  priceChange24hPercent: number | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
};

export type BirdeyeTokenMetadata = {
  decimals: number | null;
  logoUrl: string | null;
  name: string | null;
  symbol: string | null;
};

function getBirdeyeHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-api-key": serverEnv.birdeyeApiKey,
    "x-chain": "solana",
  };
}

function buildBirdeyeUrl(
  path: string,
  params: Record<string, string | number>
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }

  return `${BIRDEYE_BASE_URL}${path}?${searchParams.toString()}`;
}

async function fetchBirdeyeData<T>(
  path: string,
  params: Record<string, string | number>
): Promise<T> {
  const response = await fetchJson<BirdeyeEnvelope<T>>(
    buildBirdeyeUrl(path, params),
    {
      method: "GET",
      headers: getBirdeyeHeaders(),
    }
  );

  if (response.success === false || response.data === undefined) {
    throw new Error("Invalid Birdeye response.");
  }

  return response.data;
}

export async function fetchBirdeyePriceHistory(
  mint: string
): Promise<BirdeyePriceHistoryPoint[]> {
  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - BIRDEYE_DEFAULT_HISTORY_HOURS * 60 * 60;

  const response = await fetchBirdeyeData<BirdeyeHistoryResponse>(
    "/defi/history_price",
    {
      address: mint,
      address_type: "token",
      time_from: timeFrom,
      time_to: timeTo,
      type: BIRDEYE_DEFAULT_HISTORY_INTERVAL,
    }
  );

  if (!Array.isArray(response.items)) {
    throw new Error("Invalid Birdeye response.");
  }

  return response.items.map((item) => ({
    timestamp: item.unixTime,
    priceUsd: item.value,
  }));
}

export async function fetchBirdeyeTokenMarketData(
  mint: string
): Promise<BirdeyeTokenMarketData> {
  const response = await fetchBirdeyeData<BirdeyeTokenMarketDataResponse>(
    "/defi/v3/token/market-data",
    {
      address: mint,
    }
  );

  return {
    fullyDilutedValueUsd: response.fdv ?? null,
    liquidityUsd: response.liquidity ?? null,
    marketCapUsd: response.marketcap ?? null,
    priceChange24hPercent: response.price_change_24h_percent ?? null,
    priceUsd: response.price ?? null,
    volume24hUsd: response.volume_24h_usd ?? null,
  };
}

export async function fetchBirdeyeTokenMetadata(
  mint: string
): Promise<BirdeyeTokenMetadata> {
  const response = await fetchBirdeyeData<BirdeyeTokenMetadataResponse>(
    "/defi/v3/token/meta-data/single",
    {
      address: mint,
    }
  );

  return {
    decimals: response.decimals ?? null,
    logoUrl: response.logoURI ?? null,
    name: response.name ?? null,
    symbol: response.symbol ?? null,
  };
}
