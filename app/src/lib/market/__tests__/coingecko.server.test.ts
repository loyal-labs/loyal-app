import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let fetchCoinGeckoTokenData: typeof import("../coingecko.server").fetchCoinGeckoTokenData;
let fetchCoinGeckoTokenInfo: typeof import("../coingecko.server").fetchCoinGeckoTokenInfo;
let fetchCoinGeckoCoinChart: typeof import("../coingecko.server").fetchCoinGeckoCoinChart;
let fetchCoinGeckoPoolOhlcv: typeof import("../coingecko.server").fetchCoinGeckoPoolOhlcv;

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.COINGECKO_API_KEY;

describe("coingecko.server", () => {
  beforeAll(async () => {
    ({
      fetchCoinGeckoTokenData,
      fetchCoinGeckoTokenInfo,
      fetchCoinGeckoCoinChart,
      fetchCoinGeckoPoolOhlcv,
    } = await import("../coingecko.server"));
  });

  beforeEach(() => {
    process.env.COINGECKO_API_KEY = "test-coingecko-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();

    if (originalApiKey === undefined) {
      delete process.env.COINGECKO_API_KEY;
      return;
    }

    process.env.COINGECKO_API_KEY = originalApiKey;
  });

  test("fetchCoinGeckoTokenData hits the onchain token endpoint with the pro key and normalizes pool ids", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      expect(url.origin).toBe("https://pro-api.coingecko.com");
      expect(url.pathname).toBe("/api/v3/onchain/networks/solana/tokens/target-mint");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "x-cg-pro-api-key": "test-coingecko-key",
      });

      return new Response(
        JSON.stringify({
          data: {
            attributes: {
              name: "Loyal",
              symbol: "LOYAL",
              decimals: 6,
              image_url: "https://cdn.example.com/loyal.png",
              price_usd: "0.16312",
              market_cap_usd: "2040111.99",
              fdv_usd: "3350000.12",
              volume_usd: { h24: "120034.55" },
              total_reserve_in_usd: "410250.55",
              coingecko_coin_id: "loyal",
            },
            relationships: {
              top_pools: {
                data: [
                  { id: "solana_pool-one" },
                  { id: "solana_pool-two" },
                ],
              },
            },
          },
        }),
        { status: 200 }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCoinGeckoTokenData("target-mint")).resolves.toEqual({
      coingeckoCoinId: "loyal",
      decimals: 6,
      fdvUsd: 3_350_000.12,
      imageUrl: "https://cdn.example.com/loyal.png",
      marketCapUsd: 2_040_111.99,
      name: "Loyal",
      priceUsd: 0.16312,
      symbol: "LOYAL",
      topPoolIds: ["pool-one", "pool-two"],
      totalReserveUsd: 410_250.55,
      volumeUsd24h: 120_034.55,
    });
  });

  test("fetchCoinGeckoTokenInfo maps verification, holders, authority, and socials", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe(
        "/api/v3/onchain/networks/solana/tokens/target-mint/info"
      );

      return new Response(
        JSON.stringify({
          data: {
            attributes: {
              websites: ["https://loyal.example.com"],
              twitter_handle: "loyal",
              discord_url: "https://discord.gg/loyal",
              telegram_handle: "loyal_chat",
              description: "  Loyal token  ",
              gt_score: 84.5,
              gt_verified: true,
              holders: {
                count: 1572,
                distribution_percentage: { top_10: "42.1", rest: "57.9" },
              },
              mint_authority: "no",
              freeze_authority: "no",
            },
          },
        }),
        { status: 200 }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCoinGeckoTokenInfo("target-mint")).resolves.toEqual({
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
    });
  });

  test("fetchCoinGeckoCoinChart returns price points and the most recent total volume", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe("/api/v3/coins/loyal/market_chart");
      expect(url.searchParams.get("vs_currency")).toBe("usd");
      expect(url.searchParams.get("days")).toBe("1");

      return new Response(
        JSON.stringify({
          prices: [
            [1_712_534_400_000, 0.12],
            [1_712_620_800_000, 0.15],
          ],
          total_volumes: [
            [1_712_534_400_000, 80_000],
            [1_712_620_800_000, 95_000],
          ],
        }),
        { status: 200 }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCoinGeckoCoinChart("loyal")).resolves.toEqual({
      points: [
        { priceUsd: 0.12, timestamp: 1_712_534_400_000 },
        { priceUsd: 0.15, timestamp: 1_712_620_800_000 },
      ],
      volumeUsd24h: 95_000,
    });
  });

  test("fetchCoinGeckoPoolOhlcv extracts the close price for each candle", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe(
        "/api/v3/onchain/networks/solana/pools/pool-one/ohlcv/hour"
      );

      return new Response(
        JSON.stringify({
          data: {
            attributes: {
              ohlcv_list: [
                [1_712_534_400, 0.1, 0.2, 0.05, 0.15, 1_000],
                [1_712_538_000, 0.15, 0.18, 0.13, 0.17, 1_200],
              ],
            },
          },
        }),
        { status: 200 }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCoinGeckoPoolOhlcv("pool-one")).resolves.toEqual([
      { priceUsd: 0.15, timestamp: 1_712_534_400 },
      { priceUsd: 0.17, timestamp: 1_712_538_000 },
    ]);
  });
});
