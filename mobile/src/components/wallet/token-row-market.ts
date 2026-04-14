import { derivePriceChange24hPercent } from "@/lib/solana/token-holdings/price-change";
import type { MobileTokenDetailResponse } from "@/services/api";

import type { TokenRowMarketState } from "./tokens-list-row";

type FetchTokenRowMarketStateOptions = {
  maxAttempts?: number;
  retryDelayMs?: number;
  wait?: (ms: number) => Promise<void>;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toLoadedMarketState(
  detail: MobileTokenDetailResponse,
): TokenRowMarketState {
  return {
    status: "loaded",
    priceUsd: detail.market.priceUsd,
    priceChange24hPercent: derivePriceChange24hPercent({
      explicitPriceChange24hPercent: detail.market.priceChange24hPercent,
      chart: detail.chart,
    }),
  };
}

function hasResolvedPriceChange(state: TokenRowMarketState): boolean {
  return (
    state.status === "loaded" &&
    typeof state.priceChange24hPercent === "number" &&
    Number.isFinite(state.priceChange24hPercent)
  );
}

export async function fetchTokenRowMarketState(
  mint: string,
  fetchMarket: (mint: string) => Promise<MobileTokenDetailResponse>,
  {
    maxAttempts = 3,
    retryDelayMs = 250,
    wait: waitForRetry = wait,
  }: FetchTokenRowMarketStateOptions = {},
): Promise<TokenRowMarketState> {
  let lastLoadedState: TokenRowMarketState | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const detail = await fetchMarket(mint);
      const loadedState = toLoadedMarketState(detail);
      lastLoadedState = loadedState;

      if (hasResolvedPriceChange(loadedState)) {
        return loadedState;
      }

      if (attempt < maxAttempts && retryDelayMs > 0) {
        await waitForRetry(retryDelayMs);
      }
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts && retryDelayMs > 0) {
        await waitForRetry(retryDelayMs);
      }
    }
  }

  if (lastLoadedState) {
    return lastLoadedState;
  }

  throw lastError ?? new Error("Failed to fetch token row market");
}
