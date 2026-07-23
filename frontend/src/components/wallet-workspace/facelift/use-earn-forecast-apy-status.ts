"use client";

import { useEffect, useState } from "react";

import { fetchEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import { FALLBACK_EARN_APY } from "@/lib/kamino/earn-forecast.client";
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
  const [status, setStatus] = useState<EarnForecastApyStatus>({
    apy: FALLBACK_EARN_APY,
    isLoaded: false,
  });

  useEffect(() => {
    let isMounted = true;

    fetchEarnForecastApy()
      .then((apy) => {
        if (isMounted) {
          setStatus({ apy, isLoaded: true });
        }
      })
      .catch(() => {
        if (isMounted) {
          setStatus((current) => ({ ...current, isLoaded: true }));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return status;
}
