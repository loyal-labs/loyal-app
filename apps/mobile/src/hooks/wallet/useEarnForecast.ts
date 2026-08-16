import { useEffect, useRef, useState } from "react";

import {
  type EarnForecastSummary,
  fetchEarnForecastSummary,
} from "@/lib/solana/earn/earn-api";

// Fetches the global (per-cluster, not per-user) Earn APY forecast + history
// once. Unauthenticated — feeds the APY and Forecast charts with real data.
export function useEarnForecast() {
  const [summary, setSummary] = useState<EarnForecastSummary | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) {
      return;
    }
    fetchedRef.current = true;
    let active = true;
    fetchEarnForecastSummary()
      .then((next) => {
        if (active) {
          setSummary(next);
        }
      })
      .catch((error) => {
        console.error("Failed to fetch Earn forecast", error);
      });
    return () => {
      active = false;
    };
  }, []);

  return summary;
}
