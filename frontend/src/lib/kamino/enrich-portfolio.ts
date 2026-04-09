import {
  computePortfolioTotals,
  type PortfolioPosition,
  type PortfolioSnapshot,
} from "@loyal-labs/solana-wallet";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import {
  getCachedKaminoLendingApyBps,
  getCachedKaminoShieldedBalanceQuote,
} from "./kamino-read-client";
import {
  loadKaminoUsdcTrackedPosition,
  resolveKaminoPrincipalLiquidityAmountRaw,
  resolveTrackedKaminoUsdcMint,
} from "./kamino-usdc-position";

/**
 * Per-mint earnings metadata produced by the enrichment pass. The wallet data
 * hook merges this into the token rows it builds from the portfolio snapshot.
 */
export type KaminoEarnings = {
  mint: string;
  apyBps: number | null;
  /** Delta of earnings since principal was recorded, in USD. Null if untracked. */
  earnedValueUsd: number | null;
  /** Principal value in USD (total value minus earned). Null if untracked. */
  principalValueUsd: number | null;
};

export type EnrichedPortfolio = {
  snapshot: PortfolioSnapshot;
  /** All-time totals aggregated across tracked positions. */
  earningsTotals: {
    totalEarnedUsd: number;
    totalPrincipalUsd: number;
  } | null;
  /** Map keyed by mint base58 for quick lookup when building rows. */
  earningsByMint: Map<string, KaminoEarnings>;
};

const EMPTY_EARNINGS: EnrichedPortfolio = {
  snapshot: null as unknown as PortfolioSnapshot,
  earningsTotals: null,
  earningsByMint: new Map(),
};

function unchanged(snapshot: PortfolioSnapshot): EnrichedPortfolio {
  return {
    ...EMPTY_EARNINGS,
    snapshot,
  };
}

function replacePosition(
  positions: PortfolioPosition[],
  mint: string,
  nextPosition: PortfolioPosition
): PortfolioPosition[] {
  const index = positions.findIndex(
    (position) => position.asset.mint === mint
  );
  if (index < 0) {
    return [...positions, nextPosition];
  }
  return positions.map((position, i) =>
    i === index ? nextPosition : position
  );
}

export async function enrichSnapshotWithKaminoUsdcEarnings(args: {
  snapshot: PortfolioSnapshot;
  walletAddress: string;
  solanaEnv: SolanaEnv;
}): Promise<EnrichedPortfolio> {
  const { snapshot, walletAddress, solanaEnv } = args;

  const trackedMint = resolveTrackedKaminoUsdcMint(solanaEnv);
  if (!trackedMint) {
    return unchanged(snapshot);
  }

  const position = snapshot.positions.find(
    (p) => p.asset.mint === trackedMint
  );
  if (!position || position.securedBalance <= 0) {
    return unchanged(snapshot);
  }

  const priceUsd = position.priceUsd ?? 1;
  const decimals = position.asset.decimals;
  const scale = Math.pow(10, decimals);

  // The secureBalanceProvider reports the raw collateral-shares amount stored
  // in the Loyal deposit PDA. Convert to liquidity units via the Kamino quote.
  const actualCollateralSharesAmountRaw = BigInt(
    Math.round(position.securedBalance * scale)
  );
  if (actualCollateralSharesAmountRaw <= BigInt(0)) {
    return unchanged(snapshot);
  }

  const [quote, apyBps, trackedPosition] = await Promise.all([
    getCachedKaminoShieldedBalanceQuote({
      solanaEnv,
      mint: trackedMint,
      collateralSharesAmountRaw: actualCollateralSharesAmountRaw,
    }),
    getCachedKaminoLendingApyBps({ solanaEnv, mint: trackedMint }),
    Promise.resolve(
      loadKaminoUsdcTrackedPosition({
        publicKey: walletAddress,
        solanaEnv,
      })
    ),
  ]);

  if (!quote) {
    return unchanged(snapshot);
  }

  const currentLiquidityAmountRaw = quote.redeemableLiquidityAmountRaw;
  const liquidityBalance = Number(currentLiquidityAmountRaw) / scale;

  const principalLiquidityAmountRaw = resolveKaminoPrincipalLiquidityAmountRaw({
    trackedPosition,
    actualCollateralSharesAmountRaw,
    currentLiquidityAmountRaw,
  });
  const earnedLiquidityAmountRaw =
    principalLiquidityAmountRaw === null
      ? null
      : currentLiquidityAmountRaw > principalLiquidityAmountRaw
        ? currentLiquidityAmountRaw - principalLiquidityAmountRaw
        : BigInt(0);

  const principalBalance =
    principalLiquidityAmountRaw === null
      ? null
      : Number(principalLiquidityAmountRaw) / scale;
  const earnedBalance =
    earnedLiquidityAmountRaw === null
      ? null
      : Number(earnedLiquidityAmountRaw) / scale;

  const earnedValueUsd =
    earnedBalance === null ? null : earnedBalance * priceUsd;
  const principalValueUsd =
    principalBalance === null ? null : principalBalance * priceUsd;

  // Rewrite the secured USDC position so the snapshot totals reflect the
  // underlying liquidity (not raw collateral shares).
  const securedValueUsd = liquidityBalance * priceUsd;
  const nextPosition: PortfolioPosition = {
    ...position,
    securedBalance: liquidityBalance,
    totalBalance: position.publicBalance + liquidityBalance,
    securedValueUsd,
    totalValueUsd: (position.publicValueUsd ?? 0) + securedValueUsd,
  };

  const nextPositions = replacePosition(
    snapshot.positions,
    trackedMint,
    nextPosition
  );

  const nextTotals = computePortfolioTotals(
    nextPositions,
    snapshot.totals.effectiveSolPriceUsd
  );

  const earnings: KaminoEarnings = {
    mint: trackedMint,
    apyBps: apyBps ?? null,
    earnedValueUsd,
    principalValueUsd,
  };
  const earningsByMint = new Map<string, KaminoEarnings>();
  earningsByMint.set(trackedMint, earnings);

  return {
    snapshot: {
      ...snapshot,
      positions: nextPositions,
      totals: nextTotals,
    },
    earningsTotals:
      earnedValueUsd !== null && principalValueUsd !== null
        ? {
            totalEarnedUsd: earnedValueUsd,
            totalPrincipalUsd: principalValueUsd,
          }
        : null,
    earningsByMint,
  };
}
