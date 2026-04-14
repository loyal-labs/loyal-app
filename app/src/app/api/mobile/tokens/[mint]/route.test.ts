import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const fetchTokenDetailByMint = mock(async () => ({
  chart: [{ priceUsd: 0.12, timestamp: 1_712_534_400 }],
  links: {
    explorer: "https://solscan.io/token/target-mint",
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
  mint: "target-mint",
  token: {
    decimals: 6,
    logoUrl: "https://cdn.example.com/loyal.png",
    name: "Loyal",
    symbol: "LOYAL",
  },
}));

mock.module("@/lib/market/token-detail.server", () => ({
  fetchTokenDetailByMint,
}));

let GET: typeof import("./route").GET;
let OPTIONS: typeof import("./route").OPTIONS;

describe("mobile token detail route", () => {
  beforeAll(async () => {
    ({ GET, OPTIONS } = await import("./route"));
  });

  beforeEach(() => {
    fetchTokenDetailByMint.mockClear();
  });

  test("returns CORS preflight headers", async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, OPTIONS"
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type"
    );
  });

  test("returns the token detail payload with mobile CORS headers", async () => {
    const response = await GET(
      new Request("http://localhost/api/mobile/tokens/target-mint"),
      { params: Promise.resolve({ mint: "target-mint" }) }
    );

    expect(fetchTokenDetailByMint).toHaveBeenCalledWith("target-mint");
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      chart: [{ priceUsd: 0.12, timestamp: 1_712_534_400 }],
      links: {
        explorer: "https://solscan.io/token/target-mint",
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
      mint: "target-mint",
      token: {
        decimals: 6,
        logoUrl: "https://cdn.example.com/loyal.png",
        name: "Loyal",
        symbol: "LOYAL",
      },
    });
  });

  test("returns 500 when token detail fetch fails", async () => {
    fetchTokenDetailByMint.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const response = await GET(
      new Request("http://localhost/api/mobile/tokens/target-mint"),
      { params: Promise.resolve({ mint: "target-mint" }) }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Failed to fetch token detail",
    });
  });
});
