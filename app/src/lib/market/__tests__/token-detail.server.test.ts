import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const fetchTokenMetricsByMint = mock(async () => ({
  fdvUsd: 3_341_945.81,
  holderCount: 1_572,
  liquidityUsd: 402_595.31,
  marketCapUsd: 2_029_828.31,
  priceUsd: 0.16245,
  updatedAt: "2026-04-13T10:15:00.000Z",
}));

const fetchBirdeyeTokenMarketData = mock(async () => ({
  fullyDilutedValueUsd: 3_350_000.12,
  liquidityUsd: 410_250.55,
  marketCapUsd: 2_040_111.99,
  priceChange24hPercent: 6.25,
  priceUsd: 0.16312,
  volume24hUsd: 120_034.55,
}));

const fetchBirdeyeTokenMetadata = mock(async () => ({
  decimals: 6,
  logoUrl: "https://cdn.example.com/loyal.png",
  name: "Loyal",
  symbol: "LOYAL",
  twitter: "https://x.com/loyal",
  website: "https://loyal.example.com",
}));

const fetchBirdeyePriceHistory = mock(async () => [
  { timestamp: 1_712_534_400, priceUsd: 0.12 },
  { timestamp: 1_712_620_800, priceUsd: 0.15 },
]);

mock.module("@/lib/jupiter/tokens-v2.server", () => ({
  fetchTokenMetricsByMint,
}));

mock.module("@/lib/market/birdeye.server", () => ({
  fetchBirdeyePriceHistory,
  fetchBirdeyeTokenMarketData,
  fetchBirdeyeTokenMetadata,
}));

let fetchTokenDetailByMint: typeof import("../token-detail.server").fetchTokenDetailByMint;

describe("fetchTokenDetailByMint", () => {
  beforeAll(async () => {
    ({ fetchTokenDetailByMint } = await import("../token-detail.server"));
  });

  beforeEach(() => {
    fetchTokenMetricsByMint.mockClear();
    fetchBirdeyeTokenMarketData.mockClear();
    fetchBirdeyeTokenMetadata.mockClear();
    fetchBirdeyePriceHistory.mockClear();
  });

  test("merges Jupiter metrics, Birdeye market data, metadata, and chart history into a mobile payload", async () => {
    await expect(
      fetchTokenDetailByMint("So11111111111111111111111111111111111111112")
    ).resolves.toEqual({
      chart: [
        { priceUsd: 0.12, timestamp: 1_712_534_400 },
        { priceUsd: 0.15, timestamp: 1_712_620_800 },
      ],
      links: {
        explorer:
          "https://solscan.io/token/So11111111111111111111111111111111111111112",
        twitter: "https://x.com/loyal",
        website: "https://loyal.example.com",
      },
      market: {
        fdvUsd: 3_350_000.12,
        holderCount: 1_572,
        liquidityUsd: 410_250.55,
        marketCapUsd: 2_040_111.99,
        priceChange24hPercent: 6.25,
        priceUsd: 0.16312,
        updatedAt: "2026-04-13T10:15:00.000Z",
        volume24hUsd: 120_034.55,
      },
      mint: "So11111111111111111111111111111111111111112",
      token: {
        decimals: 6,
        logoUrl: "https://cdn.example.com/loyal.png",
        name: "Loyal",
        symbol: "LOYAL",
      },
    });

    expect(fetchTokenMetricsByMint).toHaveBeenCalledWith(
      "So11111111111111111111111111111111111111112"
    );
    expect(fetchBirdeyeTokenMarketData).toHaveBeenCalledWith(
      "So11111111111111111111111111111111111111112"
    );
    expect(fetchBirdeyeTokenMetadata).toHaveBeenCalledWith(
      "So11111111111111111111111111111111111111112"
    );
    expect(fetchBirdeyePriceHistory).toHaveBeenCalledWith(
      "So11111111111111111111111111111111111111112"
    );
  });

  test("returns a payload with null and empty fallbacks when Birdeye sections fail", async () => {
    fetchBirdeyeTokenMarketData.mockImplementationOnce(async () => {
      throw new Error("market unavailable");
    });
    fetchBirdeyeTokenMetadata.mockImplementationOnce(async () => {
      throw new Error("metadata unavailable");
    });
    fetchBirdeyePriceHistory.mockImplementationOnce(async () => {
      throw new Error("history unavailable");
    });

    await expect(
      fetchTokenDetailByMint("So11111111111111111111111111111111111111112")
    ).resolves.toEqual({
      chart: [],
      links: {
        explorer:
          "https://solscan.io/token/So11111111111111111111111111111111111111112",
        twitter: null,
        website: null,
      },
      market: {
        fdvUsd: 3_341_945.81,
        holderCount: 1_572,
        liquidityUsd: 402_595.31,
        marketCapUsd: 2_029_828.31,
        priceChange24hPercent: null,
        priceUsd: 0.16245,
        updatedAt: "2026-04-13T10:15:00.000Z",
        volume24hUsd: null,
      },
      mint: "So11111111111111111111111111111111111111112",
      token: {
        decimals: null,
        logoUrl: null,
        name: null,
        symbol: null,
      },
    });
  });
});
