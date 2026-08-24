export type EarnMaxCoverage = "complete" | "history_incomplete";

export type EarnMaxActivityItem = {
  action: string;
  id: string;
  signature: string | null;
  status: string;
  timestamp: string;
};

export type EarnMaxPerformancePoint = {
  equityUsd: number;
  timestamp: string;
};

export type EarnMaxWithdrawalView = {
  amountRaw: string;
  canCancel: boolean;
  canClaim: boolean;
  readyBy: string;
  requestId: string;
  status: "requested" | "unwinding" | "claimable" | "claimed";
};

export type EarnMaxViewModel = {
  activity: EarnMaxActivityItem[];
  balanceUsd: number;
  coverage: EarnMaxCoverage;
  earnedUsd: number | null;
  error: string | null;
  forecastApyBps: number | null;
  isBusy: boolean;
  isLoading: boolean;
  performance: EarnMaxPerformancePoint[];
  policyStatus: string | null;
  realizedApyBps: number | null;
  status: string;
  strategyLabel: string;
  withdrawal: EarnMaxWithdrawalView | null;
};

export type EarnMaxActions = {
  cancelWithdrawal: () => Promise<boolean>;
  claim: () => Promise<boolean>;
  close: () => Promise<boolean>;
  deposit: (amountRaw: bigint) => Promise<boolean>;
  install: () => Promise<boolean>;
  refresh: () => Promise<void>;
  requestWithdrawal: (amountRaw: bigint | "max") => Promise<boolean>;
};
