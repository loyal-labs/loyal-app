import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let fetchBirdeyePriceHistory: typeof import("../birdeye.server").fetchBirdeyePriceHistory;
let fetchBirdeyeTokenMarketData: typeof import("../birdeye.server").fetchBirdeyeTokenMarketData;
let fetchBirdeyeTokenMetadata: typeof import("../birdeye.server").fetchBirdeyeTokenMetadata;

const originalFetch = globalThis.fetch;
const originalBirdeyeApiKey = process.env.BIRDEYE_API_KEY;
const originalDateNow = Date.now;

describe("fetchBirdeyePriceHistory", () => {
  beforeAll(async () => {
    ({
      fetchBirdeyePriceHistory,
      fetchBirdeyeTokenMarketData,
      fetchBirdeyeTokenMetadata,
    } = await import("../birdeye.server"));
  });

  beforeEach(() => {
    process.env.BIRDEYE_API_KEY = "test-birdeye-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    mock.restore();

    if (originalBirdeyeApiKey === undefined) {
      delete process.env.BIRDEYE_API_KEY;
      return;
    }

    process.env.BIRDEYE_API_KEY = originalBirdeyeApiKey;
  });

  test("requests Birdeye history endpoint with server headers and normalizes price points", async () => {
    Date.now = () => 1_712_707_200_000;

    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      expect(url.origin).toBe("https://public-api.birdeye.so");
      expect(url.pathname).toBe("/defi/history_price");
      expect(url.searchParams.get("address")).toBe("target-mint");
      expect(url.searchParams.get("address_type")).toBe("token");
      expect(url.searchParams.get("type")).toBe("1H");
      expect(url.searchParams.get("time_from")).toBe("1712620800");
      expect(url.searchParams.get("time_to")).toBe("1712707200");

      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "x-api-key": "test-birdeye-key",
        "x-chain": "solana",
      });

      return new Response(
        JSON.stringify({
          data: {
            items: [
              { unixTime: 1712534400, value: 0.12 },
              { unixTime: 1712620800, value: 0.15 },
            ],
          },
          success: true,
        }),
        { status: 200 }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchBirdeyePriceHistory("target-mint")).resolves.toEqual([
      { priceUsd: 0.12, timestamp: 1712534400 },
      { priceUsd: 0.15, timestamp: 1712620800 },
    ]);
  });

  test("returns a minimal typed market data shape", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      expect(url.origin).toBe("https://public-api.birdeye.so");
      expect(url.pathname).toBe("/defi/v3/token/market-data");
      expect(url.searchParams.get("address")).toBe("target-mint");

      return new Response(
        JSON.stringify({
          data: {
            fdv: 3341945.81,
            liquidity: 402595.31,
            marketcap: 2029828.31,
            price: 0.16245,
            price_change_24h_percent: 6.25,
            volume_24h_usd: 120034.55,
          },
          success: true,
        }),
        { status: 200 }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchBirdeyeTokenMarketData("target-mint")).resolves.toEqual({
      fullyDilutedValueUsd: 3341945.81,
      liquidityUsd: 402595.31,
      marketCapUsd: 2029828.31,
      priceChange24hPercent: 6.25,
      priceUsd: 0.16245,
      volume24hUsd: 120034.55,
    });
  });

  test("returns a minimal typed metadata shape from the single-token endpoint", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      expect(url.origin).toBe("https://public-api.birdeye.so");
      expect(url.pathname).toBe("/defi/v3/token/meta-data/single");
      expect(url.searchParams.get("address")).toBe("target-mint");

      return new Response(
        JSON.stringify({
          data: {
            decimals: 6,
            logoURI: "https://cdn.example.com/token.png",
            name: "Loyal",
            symbol: "LOYAL",
          },
          success: true,
        }),
        { status: 200 }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchBirdeyeTokenMetadata("target-mint")).resolves.toEqual({
      decimals: 6,
      logoUrl: "https://cdn.example.com/token.png",
      name: "Loyal",
      symbol: "LOYAL",
    });
  });
});
