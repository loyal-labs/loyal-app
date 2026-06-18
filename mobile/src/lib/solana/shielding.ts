import { getDisplayTokenHoldings } from "./token-holdings/display-holdings";
import type { TokenHolding } from "./token-holdings/types";

export type ShieldDirection = "shield" | "unshield";

export type ShieldAsset = {
  key: string;
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  imageUrl: string | null;
  isSecured: boolean;
};

const DEFAULT_TOKEN_DECIMALS = 6;

const KNOWN_TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  BONK: 5,
};

export function buildShieldAssetKey(mint: string, isSecured?: boolean): string {
  return `${mint}:${isSecured ? "shielded" : "public"}`;
}

export function buildShieldAssets(
  tokenHoldings: TokenHolding[]
): ShieldAsset[] {
  return getDisplayTokenHoldings(tokenHoldings)
    .filter((holding) => holding.balance > 0)
    .map((holding) => ({
      key: buildShieldAssetKey(holding.mint, holding.isSecured),
      mint: holding.mint,
      symbol: holding.symbol,
      name: holding.name,
      balance: holding.balance,
      decimals: holding.decimals,
      imageUrl: holding.imageUrl,
      isSecured: Boolean(holding.isSecured),
    }));
}

export function getShieldDirection(
  asset: { isSecured?: boolean } | null | undefined
): ShieldDirection {
  return asset?.isSecured ? "unshield" : "shield";
}

export function resolveInitialShieldAssetKey(
  shieldAssets: ShieldAsset[],
  {
    initialMint,
    initialDirection,
  }: {
    initialMint?: string;
    initialDirection?: ShieldDirection;
  } = {}
): string | null {
  const candidates = initialDirection
    ? shieldAssets.filter(
        (asset) => getShieldDirection(asset) === initialDirection
      )
    : shieldAssets;

  if (candidates.length === 0) {
    return null;
  }

  if (!initialMint) {
    return candidates[0]?.key ?? null;
  }

  if (initialDirection) {
    return candidates.find((asset) => asset.mint === initialMint)?.key ?? null;
  }

  return (
    candidates.find(
      (asset) => asset.key === buildShieldAssetKey(initialMint, false)
    )?.key ??
    candidates.find(
      (asset) => asset.key === buildShieldAssetKey(initialMint, true)
    )?.key ??
    candidates[0]?.key ??
    null
  );
}

export function getShieldTokenDecimals(params: {
  tokenSymbol: string;
  tokenDecimals?: number | null;
}): number {
  if (
    typeof params.tokenDecimals === "number" &&
    Number.isFinite(params.tokenDecimals) &&
    params.tokenDecimals >= 0
  ) {
    return params.tokenDecimals;
  }

  return (
    KNOWN_TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ??
    DEFAULT_TOKEN_DECIMALS
  );
}

export type ComputeUnshieldModifyAmountParams = {
  isMax: boolean;
  requestedRawAmount: bigint;
  currentDepositRaw: bigint;
  isTrackedKaminoToken: boolean;
  kaminoQuotedShares: bigint | null;
};

/**
 * Decide how many raw units to burn from the shielded deposit when
 * unshielding. Units are lamports (SOL), raw SPL token amounts, or
 * Kamino collateral shares for tracked USDC.
 *
 * MAX intent bypasses the float → raw and Kamino liquidity → share
 * conversions: it returns the on-chain deposit amount directly so the
 * deposit always drains to zero. Without this, (a) float imprecision on
 * `Math.floor(displayBalance * 10^decimals)` leaves sub-unit residue for
 * SOL/USDC/USDT/LOYAL, and (b) for Kamino-tracked USDC the displayed
 * balance is the share count treated as USDC, so the quoted-share
 * conversion consistently stays below the actual deposited shares,
 * leaving an accrued-interest residue. See ASK-1135.
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

    let amount = params.kaminoQuotedShares;
    if (
      params.currentDepositRaw > BigInt(0) &&
      amount > params.currentDepositRaw
    ) {
      amount = params.currentDepositRaw;
    }
    return amount;
  }

  return params.requestedRawAmount;
}
