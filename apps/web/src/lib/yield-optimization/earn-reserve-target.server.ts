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
  type CurrentBestApyReserveByStablecoin,
  getCurrentBestApyReserveByStablecoin,
  getLatestReserveObservationsByReserve,
} from "@/lib/kamino/timescale-reserve-client.server";
import {
  type EarnProductAsset,
  resolveEarnProductAsset,
} from "./earn-product-mints.shared";
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
  liquidityTokenProgram: PublicKey;
  supplyApyBps: bigint | null;
};

export type EarnReserveTarget = EarnUsdcReserveTarget;

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
  row: CurrentBestApyReserveByStablecoin,
  productMint: EarnProductAsset
): EarnUsdcReserveTarget {
  if (!row.market) {
    throw new Error("Kamino reserve candidate is missing a market.");
  }

  return {
    liquidityMint: new PublicKey(row.liquidityMint),
    liquidityTokenProgram: productMint.tokenProgramId,
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
    liquidityTokenProgram: resolveEarnProductAsset({
      cluster,
      mint: target.liquidityMint,
    }).tokenProgramId,
    market: target.market,
    reserve: target.reserve,
    supplyApyBps: null,
  };
}

export async function findBestSafeUsdcEarnReserveTarget(
  cluster: LoyalCluster
): Promise<EarnUsdcReserveTarget | null> {
  return findBestSafeEarnReserveTarget({
    cluster,
    productMint: resolveEarnProductAsset({
      cluster,
      mint: getUsdcMint(cluster),
    }),
  });
}

export async function findBestSafeEarnReserveTarget(args: {
  cluster: LoyalCluster;
  productMint: EarnProductAsset;
}): Promise<EarnReserveTarget | null> {
  if (args.cluster === LoyalCluster.Devnet) {
    return args.productMint.stablecoin === Stablecoin.USDC
      ? getMainUsdcEarnReserveTarget(args.cluster)
      : null;
  }

  const rows = await getCurrentBestApyReserveByStablecoin({
    riskProfile: RiskBasket.Safe,
  });
  return selectBestSafeEarnReserveTarget({ ...args, rows });
}

// The routing worker's verified-reserve rounds can momentarily drop a mint
// (mid-round rewrites, per-round verification misses — observed live
// 2026-08-13 during the multi-mint rollout), which surfaces as a transient
// empty selection and a user-facing no_eligible_reserve 409. A short re-read
// bridges those blips; a genuine outage still returns null after the
// retries. Devnet selection is deterministic, so it never retries.
const RESERVE_SELECTION_RETRIES = 2;
const RESERVE_SELECTION_RETRY_DELAY_MS = 700;

export async function findBestSafeEarnReserveTargetWithRetry(args: {
  cluster: LoyalCluster;
  productMint: EarnProductAsset;
}): Promise<EarnReserveTarget | null> {
  for (let attempt = 0; ; attempt += 1) {
    const target = await findBestSafeEarnReserveTarget(args);
    if (
      target ||
      args.cluster === LoyalCluster.Devnet ||
      attempt >= RESERVE_SELECTION_RETRIES
    ) {
      return target;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, RESERVE_SELECTION_RETRY_DELAY_MS)
    );
  }
}

export function selectBestSafeEarnReserveTarget(args: {
  cluster: LoyalCluster;
  productMint: EarnProductAsset;
  rows: CurrentBestApyReserveByStablecoin[];
}): EarnReserveTarget | null {
  const safeMarkets = getSafeMarkets(args.cluster);
  const liquidityMint = args.productMint.mint.toBase58();
  const row = args.rows.find(
    (candidate) =>
      candidate.stablecoin === args.productMint.stablecoin &&
      candidate.liquidityMint === liquidityMint &&
      typeof candidate.market === "string" &&
      safeMarkets.has(candidate.market)
  );

  return row ? reserveRowToTarget(row, args.productMint) : null;
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
  return assertSafeEarnReserveMetadata({
    ...args,
    expectedLiquidityMint: getUsdcMint(args.cluster).toBase58(),
  });
}

export async function assertVerifiedSafeUsdcEarnReserveMetadata(args: {
  cluster: LoyalCluster;
  liquidityMint: string;
  market: string | null;
  targetReserve: string;
}): Promise<{
  liquidityMint: string;
  market: string;
  targetReserve: string;
}> {
  const metadata = assertSafeUsdcEarnReserveMetadata(args);

  if (args.cluster === LoyalCluster.Devnet) {
    const canonicalTarget = getKaminoUsdcEarnTargetForCluster(args.cluster);
    if (
      metadata.market !== canonicalTarget.market.toBase58() ||
      metadata.targetReserve !== canonicalTarget.reserve.toBase58()
    ) {
      throw new Error(
        "Earn reserve does not match the configured devnet target."
      );
    }
    return metadata;
  }

  const observations = await getLatestReserveObservationsByReserve({
    reserves: [metadata.targetReserve],
  });
  if (observations === null) {
    throw new Error("Earn reserve verification feed is unavailable.");
  }

  const observation = observations.find(
    (candidate) => candidate.reserve === metadata.targetReserve
  );
  if (!observation) {
    throw new Error("Earn reserve is not in the verified reserve index.");
  }
  if (observation.market !== metadata.market) {
    throw new Error("Earn reserve does not belong to the supplied market.");
  }
  if (observation.liquidityMint !== metadata.liquidityMint) {
    throw new Error("Earn reserve does not use the supplied liquidity mint.");
  }
  if (
    observation.totalSupplyUsdEstimate <= MIN_ELIGIBLE_RESERVE_TOTAL_SUPPLY_USD
  ) {
    throw new Error("Earn reserve is below the liquidity floor.");
  }

  return metadata;
}

export function assertSafeEarnReserveMetadata(args: {
  cluster: LoyalCluster;
  expectedLiquidityMint: string;
  liquidityMint: string;
  market: string | null;
  targetReserve: string;
}): {
  liquidityMint: string;
  market: string;
  targetReserve: string;
} {
  const safeMarkets = getSafeMarkets(args.cluster);

  if (args.liquidityMint !== args.expectedLiquidityMint) {
    throw new Error(
      "Earn reserve liquidity mint does not match the deposit mint."
    );
  }
  if (!(args.market && safeMarkets.has(args.market))) {
    throw new Error("Earn reserve market is not in the Safe universe.");
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
  >,
  cluster: LoyalCluster = LoyalCluster.MainnetBeta
): EarnUsdcReserveTarget {
  if (!position.currentMarket) {
    throw new Error("Active Earn position is missing current reserve market.");
  }

  return {
    liquidityMint: new PublicKey(position.currentLiquidityMint),
    liquidityTokenProgram: resolveEarnProductAsset({
      cluster,
      mint: position.currentLiquidityMint,
    }).tokenProgramId,
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
// caller select the best eligible reserve for that same mint instead.
export async function resolveEligibleEarnDepositTarget(args: {
  cluster: LoyalCluster;
  liquidityMint: string;
  logTag: string;
  position: Pick<
    UserYieldPositionRecord,
    "currentLiquidityMint" | "currentMarket" | "currentReserve"
  >;
}): Promise<EarnUsdcReserveTarget | null> {
  if (args.position.currentLiquidityMint !== args.liquidityMint) {
    return null;
  }
  const target = earnReserveTargetFromActivePosition(
    args.position,
    args.cluster
  );
  const ineligibility = await findEarnReserveTargetIneligibility({
    cluster: args.cluster,
    reserve: target.reserve.toBase58(),
  });
  if (!ineligibility) {
    return target;
  }

  console.error(
    `[${args.logTag}] refusing ineligible Earn deposit target; selecting another same-mint reserve`,
    {
      cluster: args.cluster,
      market: target.market.toBase58(),
      reason: ineligibility,
      reserve: target.reserve.toBase58(),
    }
  );
  return null;
}
