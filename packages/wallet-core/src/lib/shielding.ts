export type ComputeUnshieldModifyAmountParams = {
  isMax: boolean;
  requestedRawAmount: bigint;
  currentDepositRaw: bigint;
  isTrackedKaminoToken: boolean;
  kaminoQuotedShares: bigint | null;
};

/**
 * Decide how many raw units to burn from a shielded deposit.
 *
 * For tracked Kamino USDC, deposit amounts are collateral shares while user
 * input/display is liquidity. Max intent should burn the live deposit amount
 * directly; partial intent should use a fresh Kamino liquidity-to-share quote.
 */
export function computeUnshieldModifyAmount(
  params: ComputeUnshieldModifyAmountParams
): bigint {
  if (params.isMax) {
    if (params.currentDepositRaw > BigInt(0)) {
      return params.currentDepositRaw;
    }
    if (params.isTrackedKaminoToken) {
      throw new Error(
        "Could not read the current USDC shielded balance. Please retry."
      );
    }
    return params.requestedRawAmount;
  }

  if (params.isTrackedKaminoToken) {
    if (params.kaminoQuotedShares === null) {
      throw new Error(
        "Could not quote the current USDC shielded exchange rate. Please retry."
      );
    }

    if (
      params.currentDepositRaw > BigInt(0) &&
      params.kaminoQuotedShares > params.currentDepositRaw
    ) {
      return params.currentDepositRaw;
    }
    return params.kaminoQuotedShares;
  }

  return params.requestedRawAmount;
}
