import type { EarnEarningsResponse } from "./earnings.shared";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

function normalizeEarnedUsd(value: number) {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(6)) : 0;
}

export function deriveEarnEarningsDisplayAmounts(args: {
  apyBps: number;
  canLiveEstimate: boolean;
  dailyData: EarnEarningsResponse | null;
  generatedAt: string | null;
  lifetimeData: EarnEarningsResponse | null;
  nowMs?: number;
  principalAmount: number;
}) {
  const generatedAtMs = args.generatedAt
    ? Date.parse(args.generatedAt)
    : Number.NaN;
  const elapsedSeconds = Number.isFinite(generatedAtMs)
    ? Math.max(0, (args.nowMs ?? Date.now()) - generatedAtMs) / 1000
    : 0;
  const liveEarnedUsd = args.canLiveEstimate
    ? ((args.principalAmount * (args.apyBps / 10_000)) / SECONDS_PER_YEAR) *
      elapsedSeconds
    : 0;

  return {
    lifetimeEarnedUsd: normalizeEarnedUsd(
      (args.lifetimeData?.lifetimeEarnedUsd ?? 0) + liveEarnedUsd
    ),
    rangeEarnedUsd: normalizeEarnedUsd(
      (args.dailyData?.rangeEarnedUsd ?? 0) + liveEarnedUsd
    ),
    todayEarnedUsd: normalizeEarnedUsd(
      (args.dailyData?.todayEarnedUsd ?? 0) + liveEarnedUsd
    ),
  };
}
