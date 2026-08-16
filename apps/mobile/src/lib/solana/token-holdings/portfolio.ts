import { NATIVE_SOL_MINT, SOL_PRICE_USD } from "../constants";

import type { TokenHolding } from "./types";

export type PortfolioTotals = {
  totalUsd: number;
  totalSol: number | null;
  pricedCount: number;
  unpricedCount: number;
  effectiveSolPriceUsd: number | null;
};

function floorToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}

function getEffectiveSolPriceUsd(
  holdings: TokenHolding[],
  fallbackSolPriceUsd: number | null,
): number | null {
  const solHolding = holdings.find((h) => h.mint === NATIVE_SOL_MINT);
  const fromHoldings = solHolding?.priceUsd;
  return (
    (typeof fromHoldings === "number" && Number.isFinite(fromHoldings)
      ? fromHoldings
      : null) ??
    (typeof fallbackSolPriceUsd === "number" &&
    Number.isFinite(fallbackSolPriceUsd)
      ? fallbackSolPriceUsd
      : null) ??
    (typeof SOL_PRICE_USD === "number" && Number.isFinite(SOL_PRICE_USD)
      ? SOL_PRICE_USD
      : null)
  );
}

function holdingUsdValue(holding: TokenHolding): number | null {
  if (
    typeof holding.valueUsd === "number" &&
    Number.isFinite(holding.valueUsd)
  ) {
    return holding.valueUsd;
  }
  if (
    typeof holding.priceUsd === "number" &&
    Number.isFinite(holding.priceUsd)
  ) {
    const value = holding.balance * holding.priceUsd;
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function computePortfolioTotals(
  holdings: TokenHolding[],
  fallbackSolPriceUsd: number | null,
): PortfolioTotals {
  let totalUsd = 0;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const holding of holdings) {
    const value = holdingUsdValue(holding);
    if (value === null) {
      unpricedCount++;
      continue;
    }
    pricedCount++;
    totalUsd += value;
  }

  totalUsd = floorToDecimals(totalUsd, 2);

  const effectiveSolPriceUsd = getEffectiveSolPriceUsd(
    holdings,
    fallbackSolPriceUsd,
  );
  const totalSol =
    effectiveSolPriceUsd && effectiveSolPriceUsd > 0
      ? floorToDecimals(totalUsd / effectiveSolPriceUsd, 4)
      : null;

  return {
    totalUsd,
    totalSol,
    pricedCount,
    unpricedCount,
    effectiveSolPriceUsd,
  };
}
