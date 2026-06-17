export const EARNINGS_RANGE_IDS = ["7D", "30D", "1Y", "ALL"] as const;

export type EarningsRangeId = (typeof EARNINGS_RANGE_IDS)[number];

export type EarnEarningsBar = {
  apyBps: number | null;
  avgPrincipalUsd: number;
  earnedUsd: number;
  endAt: string;
  isCurrent: boolean;
  label: string;
  principalAmountRaw: string;
  principalUsd: number;
  startAt: string;
};

export type EarnEarningsResponse = {
  bars: EarnEarningsBar[];
  currentApyBps: number | null;
  lastDepositAt: string | null;
  lifetimeEarnedUsd: number;
  principalAmountRaw: string;
  principalUsd: number;
  rangeEarnedUsd: number;
  sinceLastDepositEarnedUsd: number;
  todayEarnedUsd: number;
};

export type EarnEarningsRangeSetResponse = {
  generatedAt: string;
  ranges: Record<EarningsRangeId, EarnEarningsResponse>;
};
