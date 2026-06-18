const FALLBACK_UPDATED_AT = "2026-06-01T00:00:00.000Z";
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type EarnForecastResponse = {
  strategy: "safe_no_fees" | "safe_fee_aware_1bps" | "medium_fee_aware_1bps";
  apyBps: number;
  rangeLowBps: number;
  rangeHighBps: number;
  window: { startedAt: string; endedAt: string };
  updatedAt: string;
};

export type EarnForecastApy = Pick<
  EarnForecastResponse,
  "apyBps" | "rangeHighBps" | "rangeLowBps"
>;

export type EarnForecastApyHistorySample = {
  observedAt: string;
  apyBps: number;
};

export type EarnForecastApyHistorySeries = {
  key: "loyal" | "mainUsdcReserve";
  label: string;
  metadata?: Record<string, string | number | boolean | null>;
  samples: EarnForecastApyHistorySample[];
};

export type EarnForecastApyHistoryResponse = {
  feeBps: 1;
  generatedAt: string;
  riskProfile: "safe" | "medium";
  samples: EarnForecastApyHistorySample[];
  series?: EarnForecastApyHistorySeries[];
  window: { startedAt: string; endedAt: string };
};

export type EarnForecastSummaryResponse = {
  forecast: EarnForecastResponse;
  history: EarnForecastApyHistoryResponse;
};

export const FALLBACK_EARN_FORECAST: EarnForecastResponse = {
  apyBps: 1197,
  rangeHighBps: 1325,
  rangeLowBps: 856,
  strategy: "safe_no_fees",
  updatedAt: FALLBACK_UPDATED_AT,
  window: {
    endedAt: FALLBACK_UPDATED_AT,
    startedAt: new Date(
      Date.parse(FALLBACK_UPDATED_AT) - DEFAULT_WINDOW_MS
    ).toISOString(),
  },
};

export function formatEarnApyLabel(apyBps: number): string {
  return `${(apyBps / 100).toFixed(2)}% APY`;
}

export function formatEarnApyPercent(apyBps: number): string {
  return `${(apyBps / 100).toFixed(2)}%`;
}

export function getEarnForecastTargetMultiplier(apyBps: number): number {
  return 1 + apyBps / 10_000;
}
