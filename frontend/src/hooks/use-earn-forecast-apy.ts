"use client";

import { useEffect, useState } from "react";

import {
  FALLBACK_EARN_APY,
  fetchEarnForecastSummary,
  resetEarnForecastSummaryCacheForTests,
  toForecastApy,
} from "@/lib/kamino/earn-forecast.client";
import { type EarnForecastApy } from "@/lib/kamino/earn-forecast.shared";

export async function fetchEarnForecastApy(): Promise<EarnForecastApy> {
  const summary = await fetchEarnForecastSummary();
  return toForecastApy(summary.forecast);
}

export function resetEarnForecastApyCacheForTests() {
  resetEarnForecastSummaryCacheForTests();
}

export function useEarnForecastApy(): EarnForecastApy {
  const [forecast, setForecast] = useState<EarnForecastApy>(FALLBACK_EARN_APY);

  useEffect(() => {
    let isMounted = true;

    fetchEarnForecastApy()
      .then((nextForecast) => {
        if (!isMounted) {
          return;
        }

        setForecast(nextForecast);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  return forecast;
}
