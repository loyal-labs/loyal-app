import type {
  EarnAutodepositState,
  EarnWithdrawSourceInfo,
} from "@/lib/solana/earn/earn-api";

export type LoadingMetricsRefundItem = {
  account: string;
  kind: "policy" | "recurring_delegation" | "vault";
  lamports: number;
};

export type LoadingMetricsEarnUiDriver = {
  autodeposit: EarnAutodepositState | null;
  closeAutodeposit(): Promise<void>;
  deposit(amountUsd: number): Promise<void>;
  refresh(): Promise<void>;
  setAutodepositFloor(thresholdUsd: number): Promise<void>;
  setupAutodeposit(thresholdUsd: number): Promise<void>;
  toggleAutodeposit(): Promise<void>;
  withdraw(args: {
    amountUsd: number;
    mode: "full" | "partial";
    source: EarnWithdrawSourceInfo | null;
  }): Promise<void>;
};

export type LoadingMetricsActivityUiDriver = {
  executeRefund(item: LoadingMetricsRefundItem): Promise<void>;
  executeScheduledSweep(): Promise<void>;
  refreshAutodeposit(): Promise<unknown>;
  scheduledSweepIds: readonly string[];
};

let earnDriver: LoadingMetricsEarnUiDriver | null = null;
let activityDriver: LoadingMetricsActivityUiDriver | null = null;

export function registerLoadingMetricsEarnUiDriver(
  driver: LoadingMetricsEarnUiDriver
): () => void {
  earnDriver = driver;
  return () => {
    if (earnDriver === driver) {
      earnDriver = null;
    }
  };
}

export function registerLoadingMetricsActivityUiDriver(
  driver: LoadingMetricsActivityUiDriver
): () => void {
  activityDriver = driver;
  return () => {
    if (activityDriver === driver) {
      activityDriver = null;
    }
  };
}

export function getLoadingMetricsEarnUiDriver(): LoadingMetricsEarnUiDriver | null {
  return earnDriver;
}

export function getLoadingMetricsActivityUiDriver(): LoadingMetricsActivityUiDriver | null {
  return activityDriver;
}
