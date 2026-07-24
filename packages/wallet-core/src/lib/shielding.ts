import type { SwapToken, TokenRow } from "../types";

export type WalletActionTokenScope = "personal" | "vault" | "signer";

export type WalletActionTokenSources = {
  personal: readonly SwapToken[];
  vault: readonly SwapToken[];
};

export type ComputeUnshieldModifyAmountParams = {
  currentDepositRaw: bigint;
  isMax: boolean;
  isTrackedKaminoToken: boolean;
  kaminoQuotedShares: bigint | null;
  requestedRawAmount: bigint;
};

export function toRoundedTokenRawAmount(
  value: number,
  decimals: number
): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    return BigInt(0);
  }

  const multiplier = 10 ** Math.min(Math.max(decimals, 0), 9);

  return BigInt(Math.round(value * multiplier));
}

export function resolveWalletActionSwapToken(
  token: TokenRow,
  scope: WalletActionTokenScope,
  sources: WalletActionTokenSources
): SwapToken {
  const canonicalTokens =
    scope === "personal"
      ? sources.personal
      : scope === "vault"
      ? sources.vault
      : [];
  const mint = token.id?.replace(/-secured$/, "");
  const canonicalToken = mint
    ? canonicalTokens.find(
        (candidate) =>
          candidate.mint === mint &&
          Boolean(candidate.isSecured) === Boolean(token.isSecured)
      )
    : undefined;

  if (canonicalToken) {
    return {
      ...canonicalToken,
      isSecured: token.isSecured,
    };
  }

  return {
    balance: Number.parseFloat(token.amount.replace(/,/g, "")) || 0,
    icon: token.icon,
    isSecured: token.isSecured,
    mint,
    price: Number.parseFloat(token.price.replace(/[$,]/g, "")) || 0,
    symbol: token.symbol,
  };
}

export function computeUnshieldModifyAmount(
  params: ComputeUnshieldModifyAmountParams
): bigint {
  if (params.isMax) {
    if (params.currentDepositRaw > 0n) {
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
      params.currentDepositRaw > 0n &&
      params.kaminoQuotedShares > params.currentDepositRaw
    ) {
      return params.currentDepositRaw;
    }
    return params.kaminoQuotedShares;
  }

  return params.requestedRawAmount;
}
