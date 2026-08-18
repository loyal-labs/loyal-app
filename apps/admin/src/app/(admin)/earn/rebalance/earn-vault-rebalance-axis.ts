import { getEarnStablecoinSymbol } from "@/lib/earn/stablecoin-monitor.shared";

const MAX_LOG_TICKS = 8;

/**
 * Powers of ten spanning the funded deposits, so the dust decades get the same
 * width as the whale decade instead of collapsing into the left edge.
 *
 * Live deposits run from a single raw unit to six figures, which is thirteen
 * decades. Labelling every one of them overlaps, so decades are thinned to a
 * readable stride while the domain still ends on a real power of ten.
 */
export function buildLogTicks(
  minAmount: number,
  maxAmount: number
): number[] {
  if (!(minAmount > 0) || !Number.isFinite(maxAmount)) {
    return [1];
  }

  const lowest = Math.floor(Math.log10(minAmount));
  const highest = Math.ceil(Math.log10(Math.max(maxAmount, minAmount)));
  const decades = highest - lowest;
  const stride = Math.max(1, Math.ceil(decades / (MAX_LOG_TICKS - 1)));

  const ticks: number[] = [];
  for (let exponent = lowest; exponent <= highest; exponent += stride) {
    ticks.push(10 ** exponent);
  }
  // Keep the top of the domain on the axis even when the stride overshoots it.
  const topTick = 10 ** highest;
  if (ticks[ticks.length - 1] !== topTick) {
    ticks.push(topTick);
  }

  return ticks;
}

export function formatLogTick(
  value: number,
  liquidityMint: string | null
): string {
  const symbol = getEarnStablecoinSymbol(liquidityMint) ?? "USD";
  const formatted =
    value >= 1000
      ? new Intl.NumberFormat("en-US", {
          compactDisplay: "short",
          maximumFractionDigits: 1,
          notation: "compact",
        }).format(value)
      : value.toLocaleString("en-US", {
          maximumFractionDigits: Math.max(0, -Math.floor(Math.log10(value))),
        });

  return `${formatted} ${symbol}`;
}
