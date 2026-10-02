"use client";

import {
  EMPTY_EARN_FORECAST_HISTORY,
  fetchEarnForecastSummary,
  resetEarnForecastSummaryCacheForTests,
} from "@/lib/kamino/earn-forecast.client";
import type { EarnForecastApyHistoryResponse } from "@/lib/kamino/earn-forecast.shared";

import { useEarnForecastSummary } from "./use-earn-forecast-summary";

export async function fetchEarnForecastApyHistory(): Promise<EarnForecastApyHistoryResponse> {
  const summary = await fetchEarnForecastSummary();
  return summary.history;
}

export function resetEarnForecastApyHistoryCacheForTests() {
  resetEarnForecastSummaryCacheForTests();
}

export function useEarnForecastApyHistory(): EarnForecastApyHistoryResponse {
  const { summary } = useEarnForecastSummary();
  return summary?.history ?? EMPTY_EARN_FORECAST_HISTORY;
}
