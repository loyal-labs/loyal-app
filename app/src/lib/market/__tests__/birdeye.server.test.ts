import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let fetchBirdeyePriceHistory: typeof import("../birdeye.server").fetchBirdeyePriceHistory;

const originalFetch = globalThis.fetch;
const originalBirdeyeApiKey = process.env.BIRDEYE_API_KEY;
const originalDateNow = Date.now;

describe("fetchBirdeyePriceHistory", () => {
  beforeAll(async () => {
    ({ fetchBirdeyePriceHistory } = await import("../birdeye.server"));
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
      expect(url.searchParams.get("type")).toBe("1D");
      expect(url.searchParams.get("time_from")).toBe("1710115200");
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
});
