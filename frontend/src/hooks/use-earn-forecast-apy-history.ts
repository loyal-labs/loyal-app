"use client";

import { useEffect, useState } from "react";

import type { EarnForecastApyHistoryResponse } from "@/lib/kamino/earn-forecast.shared";

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

const EMPTY_HISTORY: EarnForecastApyHistoryResponse = {
  feeBps: 1,
  generatedAt: "2026-06-01T00:00:00.000Z",
  riskProfile: "medium",
  samples: [],
  window: {
    endedAt: "2026-06-01T00:00:00.000Z",
    startedAt: "2026-05-02T00:00:00.000Z",
  },
};

let cachedHistory:
  | {
      expiresAt: number;
      value: EarnForecastApyHistoryResponse;
    }
  | null = null;
let inflightHistory: Promise<EarnForecastApyHistoryResponse> | null = null;

export async function fetchEarnForecastApyHistory(): Promise<EarnForecastApyHistoryResponse> {
  const now = Date.now();
  if (cachedHistory && cachedHistory.expiresAt > now) {
    return cachedHistory.value;
  }

  if (inflightHistory) {
    return inflightHistory;
  }

  inflightHistory = fetch("/api/smart-accounts/earn-forecast/apy-history", {
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Earn forecast history request failed: ${response.status}`
        );
      }

      return (await response.json()) as EarnForecastApyHistoryResponse;
    })
    .then((history) => {
      cachedHistory = {
        expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        value: history,
      };
      return history;
    })
    .catch((error) => {
      console.warn("[earn-forecast] failed to load APY history", error);
      cachedHistory = {
        expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        value: EMPTY_HISTORY,
      };
      return EMPTY_HISTORY;
    })
    .finally(() => {
      inflightHistory = null;
    });

  return inflightHistory;
}

export function resetEarnForecastApyHistoryCacheForTests() {
  cachedHistory = null;
  inflightHistory = null;
}

export function useEarnForecastApyHistory(): EarnForecastApyHistoryResponse {
  const [history, setHistory] = useState<EarnForecastApyHistoryResponse>(
    cachedHistory?.value ?? EMPTY_HISTORY
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
