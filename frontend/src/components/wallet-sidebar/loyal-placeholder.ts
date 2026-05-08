import type { TokenRow } from "./types";

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const LOYL_ICON_URL =
  "https://avatars.githubusercontent.com/u/210601628?s=200&v=4";

/**
 * Single-row placeholder for empty token lists. We surface LOYAL with zero
 * balance instead of a "No tokens yet" string so the surface stays consistent
 * with the populated state and acts as a soft prompt to discover the token.
 */
export const LOYAL_PLACEHOLDER_ROW: TokenRow = {
  id: LOYL_MINT,
  symbol: "LOYAL",
  price: "$0.00",
  amount: "0",
  value: "$0.00",
  icon: LOYL_ICON_URL,
};
