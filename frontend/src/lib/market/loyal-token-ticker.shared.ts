export const LOYAL_TOKEN_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";

export type LoyalTokenTickerData = {
  symbol: "LOYAL";
  icon: string;
  usdPrice: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeIconUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  if (value.startsWith("/") && !value.startsWith("//")) {
    return true;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isLoyalTokenTickerData(
  value: unknown
): value is LoyalTokenTickerData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.symbol === "LOYAL" &&
    isSafeIconUrl(value.icon) &&
    typeof value.usdPrice === "number" &&
    Number.isFinite(value.usdPrice) &&
    value.usdPrice > 0
  );
}
