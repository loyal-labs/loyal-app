"use client";

import {
  FALLBACK_EARN_APY,
  fetchEarnForecastSummary,
  resetEarnForecastSummaryCacheForTests,
  toForecastApy,
} from "@/lib/kamino/earn-forecast.client";
import { type EarnForecastApy } from "@/lib/kamino/earn-forecast.shared";

import { useEarnForecastSummary } from "./use-earn-forecast-summary";

export async function fetchEarnForecastApy(): Promise<EarnForecastApy> {
  const summary = await fetchEarnForecastSummary();
  return toForecastApy(summary.forecast);
}

export function resetEarnForecastApyCacheForTests() {
  resetEarnForecastSummaryCacheForTests();
}

export function useEarnForecastApy(): EarnForecastApy {
  const { summary } = useEarnForecastSummary();
  return summary ? toForecastApy(summary.forecast) : FALLBACK_EARN_APY;
}
