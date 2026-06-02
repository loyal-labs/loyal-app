const FALLBACK_UPDATED_AT = "2026-06-01T00:00:00.000Z";
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type EarnForecastResponse = {
  strategy: "safe_no_fees";
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
