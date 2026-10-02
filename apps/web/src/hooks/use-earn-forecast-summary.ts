"use client";

import { useEffect, useState } from "react";

import {
  fetchEarnForecastSummary,
  REALIZED_MAX_AGE_MS,
} from "@/lib/kamino/earn-forecast.client";
import type { EarnForecastSummaryResponse } from "@/lib/kamino/earn-forecast.shared";

// One refresh lifecycle feeds the APY, chart history, and loaded-state hooks.
// The underlying fetch also deduplicates requests from mounted consumers.
export function useEarnForecastSummary(): {
  summary: EarnForecastSummaryResponse | null;
  isLoaded: boolean;
} {
  const [state, setState] = useState<{
    summary: EarnForecastSummaryResponse | null;
    isLoaded: boolean;
  }>({ summary: null, isLoaded: false });

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const summary = await fetchEarnForecastSummary();
        if (mounted) {
          setState({ summary, isLoaded: true });
        }
      } catch {
        if (mounted) {
          setState((current) => ({ ...current, isLoaded: true }));
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      // Re-render even if the request hangs, so an old measurement expires.
      setState((current) => ({ ...current }));
      void refresh();
    }, 60_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const forecast = state.summary?.forecast;
  const expired =
    forecast?.strategy === "realized_7d_share_price" &&
    (!Number.isFinite(Date.parse(forecast.updatedAt)) ||
      Date.now() - Date.parse(forecast.updatedAt) >= REALIZED_MAX_AGE_MS);
  return {
    isLoaded: state.isLoaded,
    summary: expired ? null : state.summary,
  };
}
