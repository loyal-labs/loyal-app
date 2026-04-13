import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { MobileTokenDetailResponse } from "@/services/api";
import type { Transaction } from "@/types/wallet";

import { filterTransactionsForMint } from "./activity";
import { buildTokenPosition } from "./position";
import type { TokenDetailTransaction, TokenPosition } from "./types";

export type TokenDetailViewModel = {
  mint: string;
  token: {
    name: string;
    symbol: string;
    icon: string;
    decimals: number | null;
  };
  position: TokenPosition;
  activity: TokenDetailTransaction[];
  chart: MobileTokenDetailResponse["chart"];
  links: MobileTokenDetailResponse["links"] | null;
  market: MobileTokenDetailResponse["market"] | null;
  canSend: boolean;
  canReceive: boolean;
  canSwap: boolean;
  canShield: boolean;
  canUnshield: boolean;
};

type BuildTokenDetailViewModelInput = {
  mint: string;
  holdings: TokenHolding[];
  transactions: Transaction[];
  market: MobileTokenDetailResponse | null;
};

function derivePriceChange24hPercent(
  market: MobileTokenDetailResponse | null,
): number | null {
  const explicitPriceChange = market?.market.priceChange24hPercent;

  if (typeof explicitPriceChange === "number" && Number.isFinite(explicitPriceChange)) {
    return explicitPriceChange;
  }

  const firstPoint = market?.chart[0];
  const lastPoint = market?.chart[market.chart.length - 1];

  if (!firstPoint || !lastPoint || firstPoint.priceUsd <= 0) {
    return null;
  }

  return ((lastPoint.priceUsd - firstPoint.priceUsd) / firstPoint.priceUsd) * 100;
}

function resolveTokenIdentity(
  position: TokenPosition,
  market: MobileTokenDetailResponse | null,
): TokenDetailViewModel["token"] {
  if (position.totalBalance > 0) {
    return {
      name: position.name,
      symbol: position.symbol,
      icon: position.icon,
      decimals: market?.token.decimals ?? null,
    };
  }

  return {
    name: market?.token.name ?? position.name,
    symbol: market?.token.symbol ?? position.symbol,
    icon: market?.token.logoUrl ?? position.icon,
    decimals: market?.token.decimals ?? null,
  };
}

export function buildTokenDetailViewModel({
  mint,
  holdings,
  transactions,
  market,
}: BuildTokenDetailViewModelInput): TokenDetailViewModel {
  const position = buildTokenPosition(mint, holdings);
  const activity = filterTransactionsForMint(transactions, mint);
  const marketSummary = market
    ? {
        ...market.market,
        priceChange24hPercent: derivePriceChange24hPercent(market),
      }
    : null;

  return {
    mint,
    token: resolveTokenIdentity(position, market),
    position,
    activity,
    chart: market?.chart ?? [],
    links: market ? market.links : null,
    market: marketSummary,
    canSend: position.publicBalance > 0,
    canReceive: true,
    canSwap: true,
    canShield: position.publicBalance > 0,
    canUnshield: position.shieldedBalance > 0,
  };
}
