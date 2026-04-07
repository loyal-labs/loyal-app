import type { TokenHolding } from "../types";
import { enrichHoldingsWithJupiterPrices } from "../fetch-token-holdings";

describe("enrichHoldingsWithJupiterPrices", () => {
  it("fills missing token price and value from Jupiter search", async () => {
    const mint = "LOYL11111111111111111111111111111111111111111";
    const holdings: TokenHolding[] = [
      {
        mint,
        symbol: "LOYAL",
        name: "Loyal",
        balance: 25,
        decimals: 9,
        priceUsd: null,
        valueUsd: null,
        imageUrl: null,
      },
    ];

    const fetchMock = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => [{ id: mint, usdPrice: 0.4 }],
      } as unknown as Response);

    const result = await enrichHoldingsWithJupiterPrices(
      holdings,
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`query=${encodeURIComponent(mint)}`),
      { method: "GET" },
    );
    expect(result[0].priceUsd).toBeCloseTo(0.4, 8);
    expect(result[0].valueUsd).toBeCloseTo(10, 8);
  });

  it("keeps existing valid prices and avoids Jupiter lookups", async () => {
    const holdings: TokenHolding[] = [
      {
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Solana",
        balance: 2,
        decimals: 9,
        priceUsd: 150,
        valueUsd: 300,
        imageUrl: null,
      },
    ];

    const fetchMock = jest.fn();
    const result = await enrichHoldingsWithJupiterPrices(
      holdings,
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result[0].priceUsd).toBe(150);
    expect(result[0].valueUsd).toBe(300);
  });
});

