type PricePoint = {
  timestamp: number;
  priceUsd: number;
};

type DerivePriceChange24hPercentInput = {
  explicitPriceChange24hPercent: number | null | undefined;
  chart: PricePoint[];
};

export function derivePriceChange24hPercent({
  explicitPriceChange24hPercent,
  chart,
}: DerivePriceChange24hPercentInput): number | null {
  if (
    typeof explicitPriceChange24hPercent === "number" &&
    Number.isFinite(explicitPriceChange24hPercent)
  ) {
    return explicitPriceChange24hPercent;
  }

  const firstPoint = chart[0];
  const lastPoint = chart[chart.length - 1];

  if (!firstPoint || !lastPoint || firstPoint.priceUsd <= 0) {
    return null;
  }

  return ((lastPoint.priceUsd - firstPoint.priceUsd) / firstPoint.priceUsd) * 100;
}
