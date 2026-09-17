/** Stored reserve-rate conversion, matching SDK getTotalSupply/getCollateralExchangeRate.
 * These are stored balances, not interest-accrued quotes or current valuations.
 */
const SF = 1n << 60n;
export function collateralToLiquidityRaw(collateralRaw: bigint, supplyRaw: bigint, availableRaw: bigint,
  borrowedSf: bigint, protocolFeesSf: bigint, referrerFeesSf: bigint, pendingFeesSf: bigint): bigint {
  if ([collateralRaw, supplyRaw, availableRaw, borrowedSf, protocolFeesSf, referrerFeesSf, pendingFeesSf].some(value => value < 0n)) throw new Error("Negative reserve amount");
  const totalSf = availableRaw * SF + borrowedSf - protocolFeesSf - referrerFeesSf - pendingFeesSf;
  if (totalSf < 0n) throw new Error("Reserve fees exceed liquidity");
  if (supplyRaw === 0n || totalSf === 0n) {
    if (collateralRaw > 0n) throw new Error("Funded collateral has no supported exchange rate");
    return 0n;
  }
  return collateralRaw * totalSf / (supplyRaw * SF);
}
export function storedDebtRaw(borrowedSf: bigint): bigint {
  if (borrowedSf < 0n) throw new Error("Negative debt");
  return (borrowedSf + SF - 1n) / SF;
}
