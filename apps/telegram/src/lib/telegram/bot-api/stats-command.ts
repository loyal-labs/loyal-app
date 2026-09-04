export type LoyalStats = {
  totalAumRaw: bigint;
  totalOptimizedVolumeRaw: bigint;
  totalUsers: number;
};

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const ZERO = BigInt(0);
const RAW_PER_CENT = BigInt(10_000);
const HALF_CENT_RAW = BigInt(5_000);
const CENTS_PER_DOLLAR = BigInt(100);

function formatUsdcRaw(raw: bigint): string {
  if (raw < ZERO) {
    throw new Error("USDC metric cannot be negative");
  }

  const roundedCents = (raw + HALF_CENT_RAW) / RAW_PER_CENT;
  const wholeDollars = roundedCents / CENTS_PER_DOLLAR;
  const cents = (roundedCents % CENTS_PER_DOLLAR).toString().padStart(2, "0");

  return `$${integerFormatter.format(wholeDollars)}.${cents}`;
}

export function formatStatsCommandMessage(stats: LoyalStats): string {
  if (!Number.isSafeInteger(stats.totalUsers) || stats.totalUsers < 0) {
    throw new Error("Total user count must be a non-negative safe integer");
  }

  return [
    "Loyal Stats",
    "",
    `Total AUM: *${formatUsdcRaw(stats.totalAumRaw)}*`,
    `Total Users: *${integerFormatter.format(stats.totalUsers)}*`,
    `Total Optimized Volume: *${formatUsdcRaw(stats.totalOptimizedVolumeRaw)}*`,
  ].join("\n");
}
