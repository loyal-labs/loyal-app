import type { MobileTokenDetailResponse } from "@/services/api";
import { formatUsdSpotPrice } from "@/lib/solana/token-holdings/format-usd-price";
import {
  resolveTokenName,
  resolveTokenSymbol,
} from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

export type TokenRowMarketState =
  | {
      status: "loading";
    }
  | {
      status: "loaded";
      priceUsd: MobileTokenDetailResponse["market"]["priceUsd"];
      priceChange24hPercent: MobileTokenDetailResponse["market"]["priceChange24hPercent"];
    }
  | {
      status: "error";
    };

type TokenRowPriceChangeTone = "negative" | "neutral" | "positive" | null;

export type TokenRowContent = {
  title: string;
  usdValue: string;
  balanceWithSymbol: string;
  priceText: string;
  priceChangeText: string | null;
  priceChangeTone: TokenRowPriceChangeTone;
  showMarketSkeleton: boolean;
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatUsdPosition(value: number | null): string {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBalance(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }

  if (value < 0.0001) {
    return "<0.0001";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 1 ? 4 : 6,
  });
}

function formatPriceChange(
  value: number | null,
): { text: string | null; tone: TokenRowPriceChangeTone } {
  if (!isFiniteNumber(value)) {
    return { text: null, tone: null };
  }

  // Round before deciding sign so values like -0.001 render as "0.00%" with
  // neutral tone instead of "-0.00%" in red.
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    return { text: "0.00%", tone: "neutral" };
  }

  const sign = rounded > 0 ? "+" : "";
  const tone = rounded > 0 ? "positive" : "negative";

  return {
    text: `${sign}${rounded.toFixed(2)}%`,
    tone,
  };
}

export function buildTokenRowContent(
  holding: TokenHolding,
  marketState: TokenRowMarketState,
  overrides?: { name?: string | null; symbol?: string | null },
): TokenRowContent {
  const name = resolveTokenName({
    mint: holding.mint,
    detailName: overrides?.name,
    holdingName: holding.name,
  });
  const symbol = resolveTokenSymbol({
    mint: holding.mint,
    detailSymbol: overrides?.symbol,
    holdingSymbol: holding.symbol,
  });
  const resolvedUsdValue = isFiniteNumber(holding.valueUsd)
    ? holding.valueUsd
    : isFiniteNumber(holding.priceUsd)
      ? holding.balance * holding.priceUsd
      : holding.balance === 0
        ? 0
        : null;

  if (marketState.status === "loading") {
    return {
      title: name,
      usdValue: formatUsdPosition(resolvedUsdValue),
      balanceWithSymbol: `${formatBalance(holding.balance)} ${symbol}`.trim(),
      priceText: "",
      priceChangeText: null,
      priceChangeTone: null,
      showMarketSkeleton: true,
    };
  }

  const resolvedPriceUsd =
    marketState.status === "loaded" && isFiniteNumber(marketState.priceUsd)
      ? marketState.priceUsd
      : isFiniteNumber(holding.priceUsd)
        ? holding.priceUsd
        : null;

  const priceChange =
    marketState.status === "loaded"
      ? formatPriceChange(marketState.priceChange24hPercent)
      : { text: null, tone: null };

  return {
    title: name,
    usdValue: formatUsdPosition(resolvedUsdValue),
    balanceWithSymbol: `${formatBalance(holding.balance)} ${symbol}`.trim(),
    priceText: formatUsdSpotPrice(resolvedPriceUsd),
    priceChangeText: priceChange.text,
    priceChangeTone: priceChange.tone,
    showMarketSkeleton: false,
  };
}
