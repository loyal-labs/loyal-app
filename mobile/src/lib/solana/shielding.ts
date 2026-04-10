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

export function buildShieldAssetKey(
  mint: string,
  isSecured?: boolean,
): string {
  return `${mint}:${isSecured ? "shielded" : "public"}`;
}

export function buildShieldAssets(
  tokenHoldings: TokenHolding[],
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
  asset: { isSecured?: boolean } | null | undefined,
): ShieldDirection {
  return asset?.isSecured ? "unshield" : "shield";
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
