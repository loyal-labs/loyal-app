import { describe, expect, test } from "bun:test";

import {
  heliusAssetResponseFixture,
  USDC_MINT,
  WALLET_ADDRESS,
} from "../__fixtures__/asset-fixtures";
import {
  buildPortfolioSnapshot,
  computePortfolioTotals,
} from "../domain/portfolio";

describe("portfolio domain helpers", () => {
  test("builds positions and totals from asset snapshots", () => {
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
    });

    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.positions[0]?.asset.symbol).toBe("SOL");
    expect(snapshot.positions[1]?.totalBalance).toBe(5.25);
    expect(snapshot.totals.totalUsd).toBe(205.25);
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
          totalBalance: 5,
          priceUsd: 1,
          publicValueUsd: 5,
          totalValueUsd: 5,
        },
      ],
      100
    );

    expect(totals.totalUsd).toBe(5);
    expect(totals.totalSol).toBe(0.05);
  });

  test("derives implied unit price when priceUsd is missing but valueUsd is provided", () => {
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
    });

    const solPosition = snapshot.positions[0];
    expect(solPosition).toBeDefined();
    expect(solPosition?.priceUsd).toBeCloseTo(153.846153846, 9);
    expect(solPosition?.totalValueUsd).toBeCloseTo(6, 6);
    expect(snapshot.totals.totalUsd).toBe(6);
  });
});
