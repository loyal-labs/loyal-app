"use client";

import { useEffect, useState } from "react";

import {
  EMPTY_EARN_FORECAST_HISTORY,
  fetchEarnForecastSummary,
  resetEarnForecastSummaryCacheForTests,
} from "@/lib/kamino/earn-forecast.client";
import type { EarnForecastApyHistoryResponse } from "@/lib/kamino/earn-forecast.shared";

export async function fetchEarnForecastApyHistory(): Promise<EarnForecastApyHistoryResponse> {
  const summary = await fetchEarnForecastSummary();
  return summary.history;
}

export function resetEarnForecastApyHistoryCacheForTests() {
  resetEarnForecastSummaryCacheForTests();
}

export function useEarnForecastApyHistory(): EarnForecastApyHistoryResponse {
  const [history, setHistory] = useState<EarnForecastApyHistoryResponse>(
    EMPTY_EARN_FORECAST_HISTORY
  );

  useEffect(() => {
    let isMounted = true;

    fetchEarnForecastApyHistory()
      .then((nextHistory) => {
        if (!isMounted) {
          return;
        }

        setHistory(nextHistory);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  return history;
}
