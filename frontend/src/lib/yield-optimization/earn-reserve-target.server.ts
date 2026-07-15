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
  getLatestReserveObservationsByReserve,
  type CurrentBestApyReserveByStablecoin,
} from "@/lib/kamino/timescale-reserve-client.server";
import type { UserYieldPositionRecord } from "./yield-deposit-repository.server";

// A reserve this small cannot be a deliberate Earn venue — the hidden OnRe
// USDC reserve that swallowed a user's top-ups (ASK-1764) held ~$17k and
// later ~$37. Matches DEFAULT_MIN_TOTAL_SUPPLY_USD_ESTIMATE used for
// APY-ranked selection.
const MIN_ELIGIBLE_RESERVE_TOTAL_SUPPLY_USD = 100_000;

export type EarnReserveIneligibilityReason =
  | "below_liquidity_floor"
  | "unsampled_reserve";

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

// ASK-1764: an external rebalance execution seeded a $3 line in a HIDDEN
// Kamino reserve; the read model adopted it as current_reserve and deposit
// top-ups then routed $7.3k into a ~0%-APY venue. Deposit targets must be
// reserves our indexer actually tracks (hidden reserves are never sampled)
// with real liquidity behind them. Returns null when eligible.
export async function findEarnReserveTargetIneligibility(args: {
  cluster: LoyalCluster;
  reserve: string;
}): Promise<EarnReserveIneligibilityReason | null> {
  if (args.cluster !== LoyalCluster.MainnetBeta) {
    // The Timescale reserve feed only tracks mainnet reserves.
    return null;
  }

  const observations = await getLatestReserveObservationsByReserve({
    reserves: [args.reserve],
  });
  if (observations === null) {
    // Feed not configured in this environment — never brick deposits over a
    // config gap; the confirm-side alert still surfaces bad targets.
    return null;
  }

  const observation = observations.find(
    (candidate) => candidate.reserve === args.reserve
  );
  if (!observation) {
    return "unsampled_reserve";
  }
  if (
    observation.totalSupplyUsdEstimate <= MIN_ELIGIBLE_RESERVE_TOTAL_SUPPLY_USD
  ) {
    return "below_liquidity_floor";
  }
  return null;
}

// Deposit-routing wrapper around earnReserveTargetFromActivePosition:
// refuses to follow a position into an ineligible reserve and lets the
// caller fall through to the default main-market target instead.
// ponytail: fallback is the hardcoded MAIN target, not the best eligible
// same-market sibling — nobody currently holds an ineligible reserve, and
// full exits unwind every market since #482.
export async function resolveEligibleEarnDepositTarget(args: {
  cluster: LoyalCluster;
  logTag: string;
  position: Pick<
    UserYieldPositionRecord,
    "currentLiquidityMint" | "currentMarket" | "currentReserve"
  >;
}): Promise<EarnUsdcReserveTarget | null> {
  const target = earnReserveTargetFromActivePosition(args.position);
  const ineligibility = await findEarnReserveTargetIneligibility({
    cluster: args.cluster,
    reserve: target.reserve.toBase58(),
  });
  if (!ineligibility) {
    return target;
  }

  console.error(
    `[${args.logTag}] refusing ineligible Earn deposit target; falling back to the default reserve`,
    {
      cluster: args.cluster,
      market: target.market.toBase58(),
      reason: ineligibility,
      reserve: target.reserve.toBase58(),
    }
  );
  return null;
}
