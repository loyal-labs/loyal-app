export type SafeReserveApyStatus =
  | "eligible"
  | "stale"
  | "below-liquidity"
  | "apy-out-of-range"
  | "no-current-row"
  | "no-supported-reserve";

export type SafeReserveApyStatusRow = {
  average24hApyPercent: number | null;
  average7dApyPercent: number | null;
  latestObservedAt: string | null;
  liquidityMint: string;
  market: string;
  marketName: string | null;
  reserve: string;
  status: SafeReserveApyStatus;
  supplyApyPercent: number | null;
  symbol: string | null;
  totalSupplyUsdEstimate: number | null;
};

export type SafeReserveApySeries = {
  key: string;
  label: string;
  liquidityMint: string;
  marketName: string | null;
  reserve: string;
};

export type SafeReserveApyChartPoint = {
  observedAt: string;
  observedAtMs: number;
} & Record<string, string | number | null>;

export type SafeReserveRebalanceDecisionMarker = {
  createdAt: string;
  estimatedEdgeBps: number | null;
  id: string;
  liquidityMint: string | null;
  sourceApyBps: number | null;
  sourceReserve: string | null;
  status: string;
  targetApyBps: number | null;
  targetReserve: string | null;
};

export type SafeReserveApyMonitorData = {
  chartPoints: SafeReserveApyChartPoint[];
  generatedAt: string;
  sampleIntervalMinutes: number;
  series: SafeReserveApySeries[];
  statuses: SafeReserveApyStatusRow[];
  window: {
    endedAt: string;
    startedAt: string;
  };
};
