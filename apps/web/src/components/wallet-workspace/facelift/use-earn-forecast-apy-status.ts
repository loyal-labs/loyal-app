"use client";

import { useEarnForecastSummary } from "@/hooks/use-earn-forecast-summary";
import {
  FALLBACK_EARN_APY,
  toForecastApy,
} from "@/lib/kamino/earn-forecast.client";
import type { EarnForecastApy } from "@/lib/kamino/earn-forecast.shared";

type EarnForecastApyStatus = {
  apy: EarnForecastApy;
  isLoaded: boolean;
};

// Same data as useEarnForecastApy (the summary fetch is module-cached) plus a
// loaded flag, so views can skeleton the hardcoded fallback APY instead of
// flashing it and re-animating when the real number lands. A failed fetch
// still reveals the fallback — the skeleton must never persist.
export function useEarnForecastApyStatus(): EarnForecastApyStatus {
  const { summary, isLoaded } = useEarnForecastSummary();
  return {
    apy: summary ? toForecastApy(summary.forecast) : FALLBACK_EARN_APY,
    isLoaded,
  };
}
