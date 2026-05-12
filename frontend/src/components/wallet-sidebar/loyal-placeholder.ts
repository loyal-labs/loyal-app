import type { TokenRow } from "./types";

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const LOYL_ICON_URL =
  "https://avatars.githubusercontent.com/u/210601628?s=200&v=4";

function formatPrice(priceUsd: number | null | undefined): string {
  if (
    typeof priceUsd !== "number" ||
    !Number.isFinite(priceUsd) ||
    priceUsd <= 0
  ) {
    return "$0.00";
  }
  return priceUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Single-row placeholder for empty token lists. Surfaces LOYAL with zero
 * balance so the surface stays consistent with the populated state and acts
 * as a soft prompt to discover the token.
 */
export function buildLoyalPlaceholderRow(
  priceUsd?: number | null
): TokenRow {
  return {
    id: LOYL_MINT,
    symbol: "LOYAL",
    name: "Loyal",
    price: formatPrice(priceUsd),
    amount: "0",
    value: "$0.00",
    icon: LOYL_ICON_URL,
  };
}
