import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const fetchCoinGeckoTokenData = mock(async () => ({
  coingeckoCoinId: "loyal",
  decimals: 6,
  fdvUsd: 3_350_000.12,
  imageUrl: "https://cdn.example.com/loyal.png",
  marketCapUsd: 2_040_111.99,
  name: "Loyal",
  priceUsd: 0.16312,
  symbol: "LOYAL",
  topPoolIds: ["pool-one"],
  totalReserveUsd: 410_250.55,
  volumeUsd24h: 100_000,
}));

const fetchCoinGeckoTokenInfo = mock(async () => ({
  description: "Loyal token",
  discordUrl: "https://discord.gg/loyal",
  freezeAuthority: "no",
  gtScore: 84.5,
  gtVerified: true,
  holderCount: 1572,
  holderDistribution: { rest: "57.9", top10: "42.1" },
  mintAuthority: "no",
  telegramHandle: "loyal_chat",
  twitterHandle: "loyal",
  websites: ["https://loyal.example.com"],
}));

const fetchCoinGeckoCoinChart = mock(async () => ({
  points: [
    { priceUsd: 0.12, timestamp: 1_712_534_400_000 },
    { priceUsd: 0.15, timestamp: 1_712_620_800_000 },
  ],
  volumeUsd24h: 120_034.55,
}));

const fetchCoinGeckoPoolOhlcv = mock(async () => [
  { priceUsd: 0.13, timestamp: 1_712_534_400 },
  { priceUsd: 0.16, timestamp: 1_712_538_000 },
]);

mock.module("@/lib/market/coingecko.server", () => ({
  fetchCoinGeckoCoinChart,
  fetchCoinGeckoPoolOhlcv,
  fetchCoinGeckoTokenData,
  fetchCoinGeckoTokenInfo,
}));

let fetchTokenDetailByMint: typeof import("../token-detail.server").fetchTokenDetailByMint;

describe("fetchTokenDetailByMint", () => {
  beforeAll(async () => {
    ({ fetchTokenDetailByMint } = await import("../token-detail.server"));
  });

  beforeEach(() => {
    fetchCoinGeckoTokenData.mockClear();
    fetchCoinGeckoTokenInfo.mockClear();
    fetchCoinGeckoCoinChart.mockClear();
    fetchCoinGeckoPoolOhlcv.mockClear();
  });

  test("merges CoinGecko token, info, and coin chart into a mobile payload", async () => {
    await expect(
      fetchTokenDetailByMint("So11111111111111111111111111111111111111112")
    ).resolves.toEqual({
      chart: [
        { priceUsd: 0.12, timestamp: 1_712_534_400_000 },
        { priceUsd: 0.15, timestamp: 1_712_620_800_000 },
      ],
      info: {
        description: "Loyal token",
        freezeAuthority: "no",
        gtScore: 84.5,
        gtVerified: true,
        holderDistribution: { rest: "57.9", top10: "42.1" },
        mintAuthority: "no",
      },
      links: {
        discord: "https://discord.gg/loyal",
        explorer:
          "https://solscan.io/token/So11111111111111111111111111111111111111112",
        telegram: "https://t.me/loyal_chat",
        twitter: "https://x.com/loyal",
        website: "https://loyal.example.com",
      },
      market: {
        fdvUsd: 3_350_000.12,
        holderCount: 1572,
        liquidityUsd: 410_250.55,
        marketCapUsd: 2_040_111.99,
        priceChange24hPercent: 25,
        priceUsd: 0.16312,
        updatedAt: null,
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

    expect(fetchCoinGeckoTokenData).toHaveBeenCalledWith(
      "So11111111111111111111111111111111111111112"
    );
    expect(fetchCoinGeckoTokenInfo).toHaveBeenCalledWith(
      "So11111111111111111111111111111111111111112"
    );
    expect(fetchCoinGeckoCoinChart).toHaveBeenCalledWith("loyal");
    expect(fetchCoinGeckoPoolOhlcv).not.toHaveBeenCalled();
  });

  test("falls back to pool OHLCV when the coin chart returns no points", async () => {
    fetchCoinGeckoCoinChart.mockImplementationOnce(async () => ({
      points: [],
      volumeUsd24h: null,
    }));

    await expect(fetchTokenDetailByMint("pool-fallback-mint")).resolves.toMatchObject({
      chart: [
        { priceUsd: 0.13, timestamp: 1_712_534_400 },
        { priceUsd: 0.16, timestamp: 1_712_538_000 },
      ],
      market: { volume24hUsd: 100_000 },
    });

    expect(fetchCoinGeckoPoolOhlcv).toHaveBeenCalledWith("pool-one");
  });

  test("returns nullable defaults when CoinGecko sections fail", async () => {
    fetchCoinGeckoTokenData.mockImplementationOnce(async () => {
      throw new Error("token unavailable");
    });
    fetchCoinGeckoTokenInfo.mockImplementationOnce(async () => {
      throw new Error("info unavailable");
    });

    await expect(fetchTokenDetailByMint("failed-mint")).resolves.toEqual({
      chart: [],
      info: {
        description: null,
        freezeAuthority: null,
        gtScore: null,
        gtVerified: false,
        holderDistribution: null,
        mintAuthority: null,
      },
      links: {
        discord: null,
        explorer: "https://solscan.io/token/failed-mint",
        telegram: null,
        twitter: null,
        website: null,
      },
      market: {
        fdvUsd: null,
        holderCount: null,
        liquidityUsd: null,
        marketCapUsd: null,
        priceChange24hPercent: null,
        priceUsd: null,
        updatedAt: null,
        volume24hUsd: null,
      },
      mint: "failed-mint",
      token: { decimals: null, logoUrl: null, name: null, symbol: null },
    });

    expect(fetchCoinGeckoCoinChart).not.toHaveBeenCalled();
    expect(fetchCoinGeckoPoolOhlcv).not.toHaveBeenCalled();
  });

  test("caches repeated requests for the same mint", async () => {
    await fetchTokenDetailByMint("cached-mint");
    await fetchTokenDetailByMint("cached-mint");

    expect(fetchCoinGeckoTokenData).toHaveBeenCalledTimes(1);
    expect(fetchCoinGeckoTokenInfo).toHaveBeenCalledTimes(1);
    expect(fetchCoinGeckoCoinChart).toHaveBeenCalledTimes(1);
  });

  test("does not cache an incomplete response with no chart history", async () => {
    fetchCoinGeckoCoinChart
      .mockImplementationOnce(async () => ({ points: [], volumeUsd24h: null }))
      .mockImplementationOnce(async () => ({
        points: [
          { priceUsd: 0.12, timestamp: 1_712_534_400_000 },
          { priceUsd: 0.15, timestamp: 1_712_620_800_000 },
        ],
        volumeUsd24h: 120_034.55,
      }));
    fetchCoinGeckoPoolOhlcv.mockImplementationOnce(async () => []);

    await expect(fetchTokenDetailByMint("incomplete-mint")).resolves.toMatchObject({
      chart: [],
      mint: "incomplete-mint",
    });

    await expect(fetchTokenDetailByMint("incomplete-mint")).resolves.toMatchObject({
      chart: [
        { priceUsd: 0.12, timestamp: 1_712_534_400_000 },
        { priceUsd: 0.15, timestamp: 1_712_620_800_000 },
      ],
      mint: "incomplete-mint",
    });

    expect(fetchCoinGeckoTokenData).toHaveBeenCalledTimes(2);
    expect(fetchCoinGeckoTokenInfo).toHaveBeenCalledTimes(2);
    expect(fetchCoinGeckoCoinChart).toHaveBeenCalledTimes(2);
  });
});
