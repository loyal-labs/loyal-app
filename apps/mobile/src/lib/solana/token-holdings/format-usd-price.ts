export function formatUsdSpotPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const maximumFractionDigits =
    value >= 1 ? 2 : value >= 0.01 ? 4 : 6;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}
