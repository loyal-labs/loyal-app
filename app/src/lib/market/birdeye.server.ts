import "server-only";

import { serverEnv } from "../core/config/server";
import { fetchJson } from "../core/http";

const BIRDEYE_BASE_URL = "https://public-api.birdeye.so";
const BIRDEYE_DEFAULT_HISTORY_INTERVAL = "1D";
const BIRDEYE_DEFAULT_HISTORY_DAYS = 30;

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

type BirdeyeTokenMarketData = Record<string, unknown>;
type BirdeyeTokenMetadata = Record<string, unknown>;

export type BirdeyePriceHistoryPoint = {
  timestamp: number;
  priceUsd: number;
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

  if (response.data === undefined) {
    throw new Error("Invalid Birdeye response.");
  }

  return response.data;
}

export async function fetchBirdeyePriceHistory(
  mint: string
): Promise<BirdeyePriceHistoryPoint[]> {
  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom =
    timeTo - BIRDEYE_DEFAULT_HISTORY_DAYS * 24 * 60 * 60;

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
  return fetchBirdeyeData<BirdeyeTokenMarketData>(
    "/defi/v3/token/market-data",
    {
      address: mint,
    }
  );
}

export async function fetchBirdeyeTokenMetadata(
  mint: string
): Promise<BirdeyeTokenMetadata> {
  return fetchBirdeyeData<BirdeyeTokenMetadata>(
    "/defi/v3/token/meta-data",
    {
      address: mint,
    }
  );
}
