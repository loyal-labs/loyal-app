import { describe, expect, mock, test } from "bun:test";
import {
  getRiskBasketMarketsForCluster,
  LoyalCluster,
  RiskBasket,
} from "@loyal-labs/actions";
import { PublicKey } from "@solana/web3.js";

import type { CurrentBestApyReserveByStablecoin } from "@/lib/kamino/timescale-reserve-client.server";
import { getEarnProductAssetsForCluster } from "./earn-product-mints.shared";

mock.module("server-only", () => ({}));

const { selectBestSafeEarnReserveTarget } = await import(
  "./earn-reserve-target.server"
);

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
