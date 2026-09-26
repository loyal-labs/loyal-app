export type EarnMaxCoverage = "complete" | "history_incomplete";

export type EarnMaxActivityItem = {
  action: string;
  /** Largest positive token delta of the operation, raw USDC units. */
  amountRaw: string | null;
  id: string;
  signature: string | null;
  status: string;
  timestamp: string;
};

export type EarnMaxPolicyBinding = {
  account: string;
  matches: boolean;
  seed: string;
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

export type EarnMaxApyPoint = {
  apyBps: number;
  /** UTC day, YYYY-MM-DD. */
  date: string;
};

export type EarnMaxSummary = {
  /** Daily vault share-price APY for the chart; empty when unknown. */
  apyHistory?: EarnMaxApyPoint[];
  /** Days the headline APY covers (7 once the vault is a week old). */
  apyWindowDays?: number | null;
  balanceUsd: number;
  claimAmountRaw: string;
  coverage: EarnMaxCoverage;
  currentOperationId: string | null;
  earnedUsd: number | null;
  forecastApyBps: number | null;
  goal: string;
  policyAccounts: EarnMaxPolicyBinding[];
  policyStatus: string | null;
  realizedApyBps: number | null;
  strategyKey: string | null;
  withdrawal: EarnMaxWithdrawalView | null;
};

export type EarnMaxSummaryResponse = {
  config: {
    delegatedSigner: string;
    programId: string;
  };
  summary: EarnMaxSummary | null;
};

export type EarnMaxActivityResponse = {
  operations: EarnMaxActivityItem[];
  performance: EarnMaxPerformancePoint[];
};

export type EarnMaxViewModel = {
  activity: EarnMaxActivityItem[];
  apyHistory: EarnMaxApyPoint[];
  apyWindowDays: number | null;
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
