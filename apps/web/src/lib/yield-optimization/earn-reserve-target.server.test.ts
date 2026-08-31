import { describe, expect, mock, test } from "bun:test";
import {
  getRiskBasketMarketsForCluster,
  LoyalCluster,
  RiskBasket,
  Stablecoin,
} from "@loyal-labs/actions";
import { PublicKey } from "@solana/web3.js";

import type {
  CurrentBestApyReserveByStablecoin,
  TimescaleReservePresenceRow,
} from "@/lib/kamino/timescale-reserve-client.server";
import { getEarnProductAssetsForCluster } from "./earn-product-mints.shared";

mock.module("server-only", () => ({}));

let latestReserveObservations: TimescaleReservePresenceRow[] | null = [];

mock.module("@/lib/kamino/timescale-reserve-client.server", () => ({
  getCurrentBestApyReserveByStablecoin: async () => [],
  getLatestReserveObservationsByReserve: async () => latestReserveObservations,
}));

const {
  assertVerifiedSafeUsdcEarnReserveMetadata,
  selectBestSafeEarnReserveTarget,
} = await import("./earn-reserve-target.server");

describe("Earn same-mint reserve selection", () => {
  test("selects a Safe reserve with the exact mint and token program for every product", () => {
    const cluster = LoyalCluster.MainnetBeta;
    const [safeMarket] = getRiskBasketMarketsForCluster(
      cluster,
      RiskBasket.Safe
    );
    if (!safeMarket) {
      throw new Error("mainnet Safe market universe must not be empty");
    }

    for (const productMint of getEarnProductAssetsForCluster(cluster)) {
      const reserve = PublicKey.unique();
      const row = {
        liquidityMint: productMint.mint.toBase58(),
        market: safeMarket.toBase58(),
        reserve: reserve.toBase58(),
        stablecoin: productMint.stablecoin,
        supplyApy: 0.05,
      } as CurrentBestApyReserveByStablecoin;

      const target = selectBestSafeEarnReserveTarget({
        cluster,
        productMint,
        rows: [{ ...row, liquidityMint: PublicKey.unique().toBase58() }, row],
      });

      expect(target?.reserve.toBase58()).toBe(reserve.toBase58());
      expect(target?.liquidityMint.toBase58()).toBe(
        productMint.mint.toBase58()
      );
      expect(target?.liquidityTokenProgram.toBase58()).toBe(
        productMint.tokenProgramId.toBase58()
      );
    }
  });

  test("rejects a reserve row whose mint does not match the selected product", () => {
    const cluster = LoyalCluster.MainnetBeta;
    const [productMint] = getEarnProductAssetsForCluster(cluster);
    const [safeMarket] = getRiskBasketMarketsForCluster(
      cluster,
      RiskBasket.Safe
    );
    if (!(productMint && safeMarket)) {
      throw new Error("mainnet Earn universe must not be empty");
    }

    const target = selectBestSafeEarnReserveTarget({
      cluster,
      productMint,
      rows: [
        {
          liquidityMint: PublicKey.unique().toBase58(),
          market: safeMarket.toBase58(),
          reserve: PublicKey.unique().toBase58(),
          stablecoin: productMint.stablecoin,
          supplyApy: 0.05,
        } as CurrentBestApyReserveByStablecoin,
      ],
    });

    expect(target).toBeNull();
  });
});

describe("confirmed Earn reserve metadata", () => {
  test("accepts a verified Safe reserve outside the legacy fixed market", async () => {
    const cluster = LoyalCluster.MainnetBeta;
    const productMint = getEarnProductAssetsForCluster(cluster).find(
      (candidate) => candidate.stablecoin === Stablecoin.USDC
    );
    const safeMarkets = getRiskBasketMarketsForCluster(
      cluster,
      RiskBasket.Safe
    );
    const market = safeMarkets[1] ?? safeMarkets[0];
    if (!(productMint && market)) {
      throw new Error("mainnet Earn universe must not be empty");
    }
    const reserve = PublicKey.unique().toBase58();
    latestReserveObservations = [
      {
        liquidityMint: productMint.mint.toBase58(),
        market: market.toBase58(),
        observedAt: new Date(),
        reserve,
        totalSupplyUsdEstimate: 1_000_000,
      },
    ];

    await expect(
      assertVerifiedSafeUsdcEarnReserveMetadata({
        cluster,
        liquidityMint: productMint.mint.toBase58(),
        market: market.toBase58(),
        targetReserve: reserve,
      })
    ).resolves.toEqual({
      liquidityMint: productMint.mint.toBase58(),
      market: market.toBase58(),
      targetReserve: reserve,
    });
  });

  test("rejects a reserve whose verified market does not match", async () => {
    const cluster = LoyalCluster.MainnetBeta;
    const productMint = getEarnProductAssetsForCluster(cluster).find(
      (candidate) => candidate.stablecoin === Stablecoin.USDC
    );
    const safeMarkets = getRiskBasketMarketsForCluster(
      cluster,
      RiskBasket.Safe
    );
    const requestedMarket = safeMarkets[0];
    const indexedMarket = safeMarkets[1] ?? PublicKey.unique();
    if (!(productMint && requestedMarket)) {
      throw new Error("mainnet Earn universe must not be empty");
    }
    const reserve = PublicKey.unique().toBase58();
    latestReserveObservations = [
      {
        liquidityMint: productMint.mint.toBase58(),
        market: indexedMarket.toBase58(),
        observedAt: new Date(),
        reserve,
        totalSupplyUsdEstimate: 1_000_000,
      },
    ];

    await expect(
      assertVerifiedSafeUsdcEarnReserveMetadata({
        cluster,
        liquidityMint: productMint.mint.toBase58(),
        market: requestedMarket.toBase58(),
        targetReserve: reserve,
      })
    ).rejects.toThrow("does not belong to the supplied market");
  });
});
