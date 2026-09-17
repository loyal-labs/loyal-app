/**
 * Exact vault accounting over one coherent read snapshot.
 *
 * All math is delegated to the pinned @voltr/vault-sdk pure helpers (which
 * mirror the on-chain program's integer rounding). `currentTimeSec` is always
 * passed explicitly so a single snapshot can never be mixed with a later wall
 * clock read, and no helper here performs RPC.
 */

import {
  calculateAssetsForWithdrawAmount,
  calculateLpForDepositAmount,
  calculateLpForWithdrawAmount,
  calculateLockedProfit,
  calculateUnrealisedLpFees,
  getTotalLpSupplyInclFees,
} from "@voltr/vault-sdk";

export const ASSET_DECIMALS = 6;

/** One coherent read of every vault field the accounting needs. */
export type VaultSnapshot = Readonly<{
  assetTotalValue: bigint;
  lpSupply: bigint;
  lpDecimals: number;
  accumulatedLpAdminFees: bigint;
  accumulatedLpManagerFees: bigint;
  accumulatedLpProtocolFees: bigint;
  deadWeight: bigint;
  lastManagementFeeUpdateTs: bigint;
  managementFeeBps: number;
  issuanceFeeBps: number;
  redemptionFeeBps: number;
  lastUpdatedLockedProfit: bigint;
  lastReport: bigint;
  lockedProfitDegradationDuration: bigint;
  /** Slot of the read this snapshot came from. */
  slot: number;
  /** Wall-clock instant of the read, in seconds. */
  observedAtSec: bigint;
}>;

export type LpBreakdown = Readonly<{
  circulating: bigint;
  unharvestedFees: bigint;
  deadWeight: bigint;
  unrealisedFees: bigint;
  total: bigint;
}>;

/** Supply the program accounts against, split into disjoint components. */
export function lpSupplyBreakdown(snapshot: VaultSnapshot): LpBreakdown {
  const unharvestedFees =
    snapshot.accumulatedLpAdminFees + snapshot.accumulatedLpManagerFees + snapshot.accumulatedLpProtocolFees;
  const circulatingInclAccumulated = getTotalLpSupplyInclFees({
    lpSupply: snapshot.lpSupply,
    vaultAccumulatedLpAdminFees: snapshot.accumulatedLpAdminFees,
    vaultAccumulatedLpManagerFees: snapshot.accumulatedLpManagerFees,
    vaultAccumulatedLpProtocolFees: snapshot.accumulatedLpProtocolFees,
    vaultDeadWeight: snapshot.deadWeight,
  });
  const unrealisedFees = calculateUnrealisedLpFees(
    circulatingInclAccumulated,
    snapshot.assetTotalValue,
    snapshot.lastManagementFeeUpdateTs,
    BigInt(snapshot.managementFeeBps),
    snapshot.observedAtSec,
  );
  return {
    circulating: snapshot.lpSupply,
    unharvestedFees,
    deadWeight: snapshot.deadWeight,
    unrealisedFees,
    total: circulatingInclAccumulated + unrealisedFees,
  };
}

export function lockedProfit(snapshot: VaultSnapshot): bigint {
  return calculateLockedProfit(
    snapshot.lastUpdatedLockedProfit,
    snapshot.lockedProfitDegradationDuration,
    snapshot.observedAtSec,
    snapshot.lastReport,
  );
}

/** LP minted for a deposit, under program fee and rounding rules. */
export function lpForDepositAmount(snapshot: VaultSnapshot, assetAmountRaw: bigint): bigint {
  return calculateLpForDepositAmount({
    vaultTotalValue: snapshot.assetTotalValue,
    vaultAccumulatedLpAdminFees: snapshot.accumulatedLpAdminFees,
    vaultAccumulatedLpManagerFees: snapshot.accumulatedLpManagerFees,
    vaultAccumulatedLpProtocolFees: snapshot.accumulatedLpProtocolFees,
    vaultDeadWeight: snapshot.deadWeight,
    vaultIssuanceFeeBps: snapshot.issuanceFeeBps,
    vaultManagementFeeBps: snapshot.managementFeeBps,
    vaultLastManagementFeeUpdateTs: snapshot.lastManagementFeeUpdateTs,
    lpSupply: snapshot.lpSupply,
    assetAmount: assetAmountRaw,
    assetDecimals: ASSET_DECIMALS,
    lpDecimals: snapshot.lpDecimals,
    currentTimeSec: snapshot.observedAtSec,
  });
}

/**
 * Assets paid out for `lpAmountRaw` under program rounding (floor favours the
 * vault), after locked-profit decay and the redemption fee.
 */
export function assetsForWithdrawAmount(snapshot: VaultSnapshot, lpAmountRaw: bigint): bigint {
  return calculateAssetsForWithdrawAmount({
    vaultTotalValue: snapshot.assetTotalValue,
    vaultLastUpdatedLockedProfit: snapshot.lastUpdatedLockedProfit,
    vaultLastReport: snapshot.lastReport,
    vaultLockedProfitDegradationDuration: snapshot.lockedProfitDegradationDuration,
    vaultAccumulatedLpAdminFees: snapshot.accumulatedLpAdminFees,
    vaultAccumulatedLpManagerFees: snapshot.accumulatedLpManagerFees,
    vaultAccumulatedLpProtocolFees: snapshot.accumulatedLpProtocolFees,
    vaultDeadWeight: snapshot.deadWeight,
    vaultRedemptionFeeBps: snapshot.redemptionFeeBps,
    vaultManagementFeeBps: snapshot.managementFeeBps,
    vaultLastManagementFeeUpdateTs: snapshot.lastManagementFeeUpdateTs,
    lpSupply: snapshot.lpSupply,
    lpAmount: lpAmountRaw,
    currentTimeSec: snapshot.observedAtSec,
  });
}

/** LP that must be burned to redeem at least `assetAmountRaw` (rounds up). */
export function lpForWithdrawAmount(snapshot: VaultSnapshot, assetAmountRaw: bigint): bigint {
  return calculateLpForWithdrawAmount({
    vaultTotalValue: snapshot.assetTotalValue,
    vaultLastUpdatedLockedProfit: snapshot.lastUpdatedLockedProfit,
    vaultLastReport: snapshot.lastReport,
    vaultLockedProfitDegradationDuration: snapshot.lockedProfitDegradationDuration,
    vaultAccumulatedLpAdminFees: snapshot.accumulatedLpAdminFees,
    vaultAccumulatedLpManagerFees: snapshot.accumulatedLpManagerFees,
    vaultAccumulatedLpProtocolFees: snapshot.accumulatedLpProtocolFees,
    vaultDeadWeight: snapshot.deadWeight,
    vaultRedemptionFeeBps: snapshot.redemptionFeeBps,
    vaultManagementFeeBps: snapshot.managementFeeBps,
    vaultLastManagementFeeUpdateTs: snapshot.lastManagementFeeUpdateTs,
    lpSupply: snapshot.lpSupply,
    assetAmount: assetAmountRaw,
    currentTimeSec: snapshot.observedAtSec,
  });
}

/**
 * Receipts record the request-time payout as an unsigned 128-bit U80F48
 * decimal-bits value (48 fractional bits) that already encodes RAW asset units,
 * exactly as the SDK compares `convertDecimalBitsToNumber(receipt.amountAssetToWithdrawDecimalBits)`
 * with the raw-unit result of `calculateAssetsForWithdrawAmount`. Conversion to
 * raw units is therefore a 48-bit right shift, floored; no decimals scaling.
 */
export const DECIMAL_FRACTIONAL_BITS = 48n;

export function decimalBitsToRaw(bits: bigint): string {
  return (bits >> DECIMAL_FRACTIONAL_BITS).toString();
}

/**
 * Effective receipt payout: the program pays the lower of the request-time
 * amount and the current-snapshot amount. Both are computed from one snapshot.
 */
export function receiptEffectiveAssetRaw(
  snapshot: VaultSnapshot,
  receipt: Readonly<{ amountLpEscrowed: bigint; amountAssetToWithdrawDecimalBits: bigint }>,
): { atRequestRaw: string; atPresentRaw: string; effectiveRaw: string } {
  const atRequestRaw = decimalBitsToRaw(receipt.amountAssetToWithdrawDecimalBits);
  const atPresentRaw = assetsForWithdrawAmount(snapshot, receipt.amountLpEscrowed).toString();
  const atPresent = BigInt(atPresentRaw);
  const atRequest = BigInt(atRequestRaw);
  return {
    atRequestRaw,
    atPresentRaw: atPresentRaw,
    effectiveRaw: (atPresent < atRequest ? atPresent : atRequest).toString(),
  };
}

/**
 * Value of ONE WHOLE LP unit (10^lpDecimals raw units), floor-rounded. A
 * per-smallest-unit quote would round to zero for every realistic supply.
 * 0n when supply is empty. This is a valuation disclosure only: it carries the
 * locked-profit decay and redemption-fee semantics of the snapshot it came
 * from, and is not a withdrawal quote.
 */
export function assetsPerWholeLpRaw(snapshot: VaultSnapshot): { raw: string; lpUnitRaw: string; lockedProfitRaw: string; redemptionFeeBps: number } {
  const breakdown = lpSupplyBreakdown(snapshot);
  const lpUnitRaw = 10n ** BigInt(snapshot.lpDecimals);
  if (breakdown.total === 0n) {
    return { raw: "0", lpUnitRaw: lpUnitRaw.toString(), lockedProfitRaw: lockedProfit(snapshot).toString(), redemptionFeeBps: snapshot.redemptionFeeBps };
  }
  const quoted = (snapshot.assetTotalValue * lpUnitRaw) / breakdown.total;
  return {
    raw: quoted.toString(),
    lpUnitRaw: lpUnitRaw.toString(),
    lockedProfitRaw: lockedProfit(snapshot).toString(),
    redemptionFeeBps: snapshot.redemptionFeeBps,
  };
}
