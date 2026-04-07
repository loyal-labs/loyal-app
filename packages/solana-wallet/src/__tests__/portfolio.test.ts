import { describe, expect, test } from "bun:test";

import {
  heliusAssetResponseFixture,
  USDC_MINT,
  WALLET_ADDRESS,
} from "../__fixtures__/asset-fixtures";
import {
  buildPortfolioSnapshot,
  computePortfolioTotals,
  flattenPortfolioPositions,
} from "../domain/portfolio";

describe("portfolio domain helpers", () => {
  test("builds positions, totals, and flattened holdings from asset snapshots", () => {
    const snapshot = buildPortfolioSnapshot({
      assetSnapshot: {
        owner: WALLET_ADDRESS,
        nativeBalanceLamports: 2_000_000_000,
        fetchedAt: 1,
        assets: [
          {
            asset: {
              mint: "So11111111111111111111111111111111111111112",
              symbol: "SOL",
              name: "Solana",
              decimals: 9,
              imageUrl: null,
              isNative: true,
            },
            balance: 2,
            priceUsd: 100,
            valueUsd: 200,
          },
          {
            asset: {
              mint: USDC_MINT,
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              imageUrl: "https://cdn.example.com/usdc.png",
              isNative: false,
            },
            balance: 5.25,
            priceUsd: 1,
            valueUsd: 5.25,
          },
        ],
      },
      secureBalances: new Map([[USDC_MINT, BigInt(750_000)]]),
    });

    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.positions[1]?.securedBalance).toBe(0.75);
    expect(snapshot.totals.totalUsd).toBe(206);

    const holdings = flattenPortfolioPositions(snapshot.positions, {
      splitSecuredBalances: true,
    });
    expect(holdings).toHaveLength(3);
    expect(holdings[2]).toMatchObject({
      mint: USDC_MINT,
      isSecured: true,
      balance: 0.75,
    });
  });

  test("computes totals with fallback sol price when native price is missing", () => {
    const totals = computePortfolioTotals(
      [
        {
          asset: {
            mint: heliusAssetResponseFixture.result.items[0]!.id,
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            imageUrl: null,
            isNative: false,
          },
          publicBalance: 5,
          securedBalance: 0,
          totalBalance: 5,
          priceUsd: 1,
          publicValueUsd: 5,
          securedValueUsd: 0,
          totalValueUsd: 5,
        },
      ],
      100
    );

    expect(totals.totalUsd).toBe(5);
    expect(totals.totalSol).toBe(0.05);
  });

  test("values secured balances using implied unit price when priceUsd is missing", () => {
    const solMint = "So11111111111111111111111111111111111111112";
    const snapshot = buildPortfolioSnapshot({
      assetSnapshot: {
        owner: WALLET_ADDRESS,
        nativeBalanceLamports: 39_000_000,
        fetchedAt: 1,
        assets: [
          {
            asset: {
              mint: solMint,
              symbol: "SOL",
              name: "Solana",
              decimals: 9,
              imageUrl: null,
              isNative: true,
            },
            balance: 0.039,
            priceUsd: null,
            valueUsd: 6,
          },
        ],
      },
      secureBalances: new Map([[solMint, BigInt(39_000_000)]]),
    });

    const solPosition = snapshot.positions[0];
    expect(solPosition).toBeDefined();
    expect(solPosition?.priceUsd).toBeCloseTo(153.846153846, 9);
    expect(solPosition?.securedValueUsd).toBeCloseTo(6, 6);
    expect(solPosition?.totalValueUsd).toBeCloseTo(12, 6);
    expect(snapshot.totals.totalUsd).toBe(12);
  });
});
