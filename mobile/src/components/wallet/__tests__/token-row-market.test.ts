import type { MobileTokenDetailResponse } from "@/services/api";

import { fetchTokenRowMarketState } from "../token-row-market";

const baseDetail: MobileTokenDetailResponse = {
  mint: "mint-sol",
  token: {
    decimals: 9,
    logoUrl: null,
    name: "Solana",
    symbol: "SOL",
  },
  links: {
    website: null,
    twitter: null,
    explorer: null,
  },
  market: {
    fdvUsd: null,
    holderCount: null,
    liquidityUsd: null,
    marketCapUsd: null,
    priceChange24hPercent: null,
    priceUsd: 84.96,
    updatedAt: null,
    volume24hUsd: null,
  },
  chart: [],
};

describe("fetchTokenRowMarketState", () => {
  it("retries by default when the first response cannot produce a 24h delta", async () => {
    const wait = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
    const fetchMarket = jest
      .fn<Promise<MobileTokenDetailResponse>, [string]>()
      .mockResolvedValueOnce(baseDetail)
      .mockResolvedValueOnce({
        ...baseDetail,
        chart: [
          { timestamp: 1, priceUsd: 80 },
          { timestamp: 2, priceUsd: 84 },
        ],
      });

    await expect(
      fetchTokenRowMarketState("mint-sol", fetchMarket, {
        retryDelayMs: 250,
        wait,
      }),
    ).resolves.toEqual({
      status: "loaded",
      priceUsd: 84.96,
      priceChange24hPercent: 5,
    });
    expect(fetchMarket).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it("still supports explicit retries when a caller opts in", async () => {
    const wait = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
    const fetchMarket = jest
      .fn<Promise<MobileTokenDetailResponse>, [string]>()
      .mockResolvedValueOnce(baseDetail)
      .mockResolvedValueOnce({
        ...baseDetail,
        chart: [
          { timestamp: 1, priceUsd: 80 },
          { timestamp: 2, priceUsd: 84 },
        ],
      });

    await expect(
      fetchTokenRowMarketState("mint-sol", fetchMarket, {
        maxAttempts: 2,
        retryDelayMs: 250,
        wait,
      }),
    ).resolves.toEqual({
      status: "loaded",
      priceUsd: 84.96,
      priceChange24hPercent: 5,
    });
    expect(fetchMarket).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it("returns the last loaded state when explicit retries are exhausted", async () => {
    const fetchMarket = jest
      .fn<Promise<MobileTokenDetailResponse>, [string]>()
      .mockResolvedValue(baseDetail);

    await expect(
      fetchTokenRowMarketState("mint-sol", fetchMarket, {
        maxAttempts: 2,
        retryDelayMs: 0,
      }),
    ).resolves.toEqual({
      status: "loaded",
      priceUsd: 84.96,
      priceChange24hPercent: null,
    });
    expect(fetchMarket).toHaveBeenCalledTimes(2);
  });
});
