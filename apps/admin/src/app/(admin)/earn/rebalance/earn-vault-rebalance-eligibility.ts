import type { SafeReserveApyStatusRow } from "@/lib/kamino/timescale-reserve-monitor.shared";

/**
 * Mirrors `EconomicPolicy::default()` from the fleet planner in
 * `loyal-yield-routing`
 * (`crates/loyal-yield-store/src/fleet_orchestration/domain.rs`).
 *
 * The planner refuses to move a vault unless the expected holding gain clears
 * `cost_safety_multiplier * execution_cost + fixed_safety_margin`, and the
 * remaining net gain is at least `minimum_net_gain`. Keep these values in sync
 * with the Rust defaults; they exist here only so the admin chart can explain
 * why a vault is sitting at zero.
 */
export const REBALANCE_ECONOMIC_POLICY = {
  fixedSafetyMarginUsdMicros: 50_000,
  holdingHorizonSeconds: 30 * 24 * 60 * 60,
  minimumNetGainUsdMicros: 100_000,
  minimumNotionalUsdMicros: 1_000_000,
} as const;

const SECONDS_PER_YEAR = 31_536_000;
const USD_MICROS = 1_000_000;

/**
 * Smallest deposit that could clear the planner's economic gate, expressed in
 * raw token units.
 *
 * This is a *floor*, not a prediction: it assumes zero execution cost, full
 * confidence, and the widest spread on the board, so it is the most generous
 * threshold the planner could ever apply. A vault below it cannot produce a
 * rebalance no matter how the market moves, which is exactly what makes it a
 * fair denominator - it can never hide a genuinely stuck vault. Vaults above it
 * are merely plausible candidates, so the eligible set stays a superset of the
 * set that actually rebalances.
 *
 * Returns `null` when no usable APY spread is available, in which case callers
 * should fall back to counting every funded vault.
 */
export function computeRebalanceEligibilityFloorRaw(
  reserveStatuses: readonly SafeReserveApyStatusRow[],
  decimals: number
): bigint | null {
  // Only reserves the Safe monitor still considers eligible can anchor a
  // spread. Stale or below-liquidity reserves routinely report 0%, which would
  // otherwise invent an enormous edge and collapse the floor to nothing.
  const apys = reserveStatuses
    .filter((status) => status.status === "eligible")
    .map((status) => status.supplyApyPercent)
    .filter((apy): apy is number => apy !== null && Number.isFinite(apy) && apy > 0);
  if (apys.length < 2) {
    return null;
  }

  const bestEdgeFraction = (Math.max(...apys) - Math.min(...apys)) / 100;
  if (bestEdgeFraction <= 0) {
    return null;
  }

  const horizonFraction =
    REBALANCE_ECONOMIC_POLICY.holdingHorizonSeconds / SECONDS_PER_YEAR;
  const requiredGainUsd =
    (REBALANCE_ECONOMIC_POLICY.minimumNetGainUsdMicros +
      REBALANCE_ECONOMIC_POLICY.fixedSafetyMarginUsdMicros) /
    USD_MICROS;
  const gainFloorUsd = requiredGainUsd / (bestEdgeFraction * horizonFraction);
  const notionalFloorUsd =
    REBALANCE_ECONOMIC_POLICY.minimumNotionalUsdMicros / USD_MICROS;

  return toRawAmount(Math.max(gainFloorUsd, notionalFloorUsd), decimals);
}

function toRawAmount(amount: number, decimals: number): bigint {
  const scale = 10 ** decimals;
  return BigInt(Math.ceil(amount * scale));
}

/**
 * Splits funded vaults into the set the planner could act on and the dust it
 * will always decline. `floorRaw` of `null` means the spread is unknown, so
 * every vault stays eligible rather than being silently hidden.
 */
export function summarizeRebalanceEligibility<
  Vault extends { currentDepositRaw: string; rebalanceCount: number },
>(
  vaults: readonly Vault[],
  floorRaw: bigint | null
): {
  eligibleCount: number;
  eligibleRebalancedCount: number;
  ineligibleCount: number;
} {
  let eligibleCount = 0;
  let eligibleRebalancedCount = 0;

  for (const vault of vaults) {
    if (floorRaw !== null && BigInt(vault.currentDepositRaw) < floorRaw) {
      continue;
    }
    eligibleCount += 1;
    if (vault.rebalanceCount > 0) {
      eligibleRebalancedCount += 1;
    }
  }

  return {
    eligibleCount,
    eligibleRebalancedCount,
    ineligibleCount: vaults.length - eligibleCount,
  };
}
