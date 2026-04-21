import type { HeliusAsset, TokenHolding } from "../types";
import {
  enrichHoldingsWithJupiterPrices,
  mapAssetToHolding,
} from "../fetch-token-holdings";

describe("mapAssetToHolding", () => {
  const baseAsset: HeliusAsset = {
    id: "MintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    interface: "FungibleToken",
    token_info: {
      symbol: "FOO",
      balance: 1_000_000,
      decimals: 6,
    },
    content: {
      metadata: { name: "Foo Token", symbol: "FOO" },
    },
  };

  it("returns a holding for FungibleToken assets", () => {
    expect(mapAssetToHolding(baseAsset)).toMatchObject({
      mint: baseAsset.id,
      symbol: "FOO",
      balance: 1,
      decimals: 6,
    });
  });

  it("returns a holding for FungibleAsset (token-2022 with extensions)", () => {
    expect(
      mapAssetToHolding({ ...baseAsset, interface: "FungibleAsset" }),
    ).not.toBeNull();
  });

  it("drops Seeker Genesis Token and other NFT-like assets", () => {
    const sbtAsset: HeliusAsset = {
      ...baseAsset,
      id: "SeekerGenesisToken1111111111111111111111111",
      interface: "V1_NFT",
      token_info: { symbol: "SeekerGT", balance: 1, decimals: 0 },
      content: { metadata: { name: "Seeker Genesis Token", symbol: "SeekerGT" } },
    };
    expect(mapAssetToHolding(sbtAsset)).toBeNull();

    for (const iface of ["V2_NFT", "ProgrammableNFT", "MplCoreAsset", "Custom"]) {
      expect(mapAssetToHolding({ ...baseAsset, interface: iface })).toBeNull();
    }
  });

  it("returns null when token_info is missing", () => {
    expect(
      mapAssetToHolding({ ...baseAsset, token_info: undefined }),
    ).toBeNull();
  });
});

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

