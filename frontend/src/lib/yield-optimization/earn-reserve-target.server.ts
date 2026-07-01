import "server-only";

import {
  getKaminoUsdcEarnTargetForCluster,
  getRiskBasketMarketsForCluster,
  getStablecoinMintForCluster,
  LoyalCluster,
  RiskBasket,
  Stablecoin,
} from "@loyal-labs/actions";
import { PublicKey } from "@solana/web3.js";

import {
  getCurrentBestApyReserveByStablecoin,
  type CurrentBestApyReserveByStablecoin,
} from "@/lib/kamino/timescale-reserve-client.server";
import type { UserYieldPositionRecord } from "./yield-deposit-repository.server";

export type EarnUsdcReserveTarget = {
  reserve: PublicKey;
  market: PublicKey;
  liquidityMint: PublicKey;
  supplyApyBps: bigint | null;
};

function supplyApyToBps(supplyApy: number): bigint {
  return BigInt(Math.round(supplyApy * 10_000));
}

function getUsdcMint(cluster: LoyalCluster): PublicKey {
  return getStablecoinMintForCluster(cluster, Stablecoin.USDC);
}

function getSafeMarkets(cluster: LoyalCluster): Set<string> {
  return new Set(
    getRiskBasketMarketsForCluster(cluster, RiskBasket.Safe).map((market) =>
      market.toBase58()
    )
  );
}

function reserveRowToTarget(
  row: CurrentBestApyReserveByStablecoin
): EarnUsdcReserveTarget {
  if (!row.market) {
    throw new Error("Kamino reserve candidate is missing a market.");
  }

  return {
    liquidityMint: new PublicKey(row.liquidityMint),
    market: new PublicKey(row.market),
    reserve: new PublicKey(row.reserve),
    supplyApyBps: supplyApyToBps(row.supplyApy),
  };
}

export function getMainUsdcEarnReserveTarget(
  cluster: LoyalCluster
): EarnUsdcReserveTarget {
  const target = getKaminoUsdcEarnTargetForCluster(cluster);
  return {
    liquidityMint: target.liquidityMint,
    market: target.market,
    reserve: target.reserve,
    supplyApyBps: null,
  };
}

export async function findBestSafeUsdcEarnReserveTarget(
  cluster: LoyalCluster
): Promise<EarnUsdcReserveTarget | null> {
  if (cluster === LoyalCluster.Devnet) {
    return getMainUsdcEarnReserveTarget(cluster);
  }

  const usdcMint = getUsdcMint(cluster).toBase58();
  const safeMarkets = getSafeMarkets(cluster);
  const rows = await getCurrentBestApyReserveByStablecoin({
    riskProfile: RiskBasket.Safe,
  });
  const row = rows.find(
    (candidate) =>
      candidate.stablecoin === Stablecoin.USDC &&
      candidate.liquidityMint === usdcMint &&
      typeof candidate.market === "string" &&
      safeMarkets.has(candidate.market)
  );

  return row ? reserveRowToTarget(row) : null;
}

export function assertSafeUsdcEarnReserveMetadata(args: {
  cluster: LoyalCluster;
  liquidityMint: string;
  market: string | null;
  targetReserve: string;
}): {
  liquidityMint: string;
  market: string;
  targetReserve: string;
} {
  const expectedUsdcMint = getUsdcMint(args.cluster).toBase58();
  const safeMarkets = getSafeMarkets(args.cluster);

  if (args.liquidityMint !== expectedUsdcMint) {
    throw new Error(
      "Earn reserve liquidity mint must be the cluster USDC mint."
    );
  }
  if (!args.market || !safeMarkets.has(args.market)) {
    throw new Error("Earn reserve market is not in the Safe USDC universe.");
  }

  new PublicKey(args.targetReserve);
  new PublicKey(args.market);
  new PublicKey(args.liquidityMint);

  return {
    liquidityMint: args.liquidityMint,
    market: args.market,
    targetReserve: args.targetReserve,
  };
}

export function earnReserveTargetFromActivePosition(
  position: Pick<
    UserYieldPositionRecord,
    "currentLiquidityMint" | "currentMarket" | "currentReserve"
  >
): EarnUsdcReserveTarget {
  if (!position.currentMarket) {
    throw new Error("Active Earn position is missing current reserve market.");
  }

  return {
    liquidityMint: new PublicKey(position.currentLiquidityMint),
    market: new PublicKey(position.currentMarket),
    reserve: new PublicKey(position.currentReserve),
    supplyApyBps: null,
  };
}
