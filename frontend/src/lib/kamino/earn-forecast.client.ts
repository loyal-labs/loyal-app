"use client";

import {
  FALLBACK_EARN_FORECAST,
  type EarnForecastApy,
  type EarnForecastApyHistoryResponse,
  type EarnForecastSummaryResponse,
} from "./earn-forecast.shared";

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

export const FALLBACK_EARN_APY = {
  apyBps: FALLBACK_EARN_FORECAST.apyBps,
  rangeHighBps: FALLBACK_EARN_FORECAST.rangeHighBps,
  rangeLowBps: FALLBACK_EARN_FORECAST.rangeLowBps,
} as const satisfies EarnForecastApy;

export const EMPTY_EARN_FORECAST_HISTORY: EarnForecastApyHistoryResponse = {
  feeBps: 1,
  generatedAt: "2026-06-01T00:00:00.000Z",
  riskProfile: "safe",
  samples: [],
  window: {
    endedAt: "2026-06-01T00:00:00.000Z",
    startedAt: "2026-05-02T00:00:00.000Z",
  },
};

const FALLBACK_SUMMARY: EarnForecastSummaryResponse = {
  forecast: FALLBACK_EARN_FORECAST,
  history: EMPTY_EARN_FORECAST_HISTORY,
};

let cachedSummary:
  | {
      expiresAt: number;
      value: EarnForecastSummaryResponse;
    }
  | null = null;
let inflightSummary: Promise<EarnForecastSummaryResponse> | null = null;

export function toForecastApy(
  payload: EarnForecastSummaryResponse["forecast"]
): EarnForecastApy {
  return {
    apyBps: payload.apyBps,
    rangeHighBps: payload.rangeHighBps,
    rangeLowBps: payload.rangeLowBps,
  };
}

export async function fetchEarnForecastSummary(): Promise<EarnForecastSummaryResponse> {
  const now = Date.now();
  if (cachedSummary && cachedSummary.expiresAt > now) {
    return cachedSummary.value;
  }

  if (inflightSummary) {
    return inflightSummary;
  }

  inflightSummary = fetch("/api/smart-accounts/earn-forecast/summary", {
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Earn forecast summary request failed: ${response.status}`
        );
      }

      return (await response.json()) as EarnForecastSummaryResponse;
    })
    .then((summary) => {
      cachedSummary = {
        expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        value: summary,
      };
      return summary;
    })
    .catch((error) => {
      console.warn("[earn-forecast] failed to load summary", error);
      cachedSummary = {
        expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        value: FALLBACK_SUMMARY,
      };
      return FALLBACK_SUMMARY;
    })
    .finally(() => {
      inflightSummary = null;
    });

  return inflightSummary;
}

export function getCachedEarnForecastSummaryForTests() {
  return cachedSummary?.value ?? null;
}

export function resetEarnForecastSummaryCacheForTests() {
  cachedSummary = null;
  inflightSummary = null;
}
