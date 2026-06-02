"use client";

import { useEffect, useState } from "react";

import {
  FALLBACK_EARN_FORECAST,
  type EarnForecastApy,
  type EarnForecastResponse,
} from "@/lib/kamino/earn-forecast.shared";

const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_EARN_APY = {
  apyBps: FALLBACK_EARN_FORECAST.apyBps,
  rangeHighBps: FALLBACK_EARN_FORECAST.rangeHighBps,
  rangeLowBps: FALLBACK_EARN_FORECAST.rangeLowBps,
} as const satisfies EarnForecastApy;

let cachedForecast:
  | {
      expiresAt: number;
      value: EarnForecastApy;
    }
  | null = null;
let inflightForecast: Promise<EarnForecastApy> | null = null;

function toForecastApy(payload: EarnForecastResponse): EarnForecastApy {
  return {
    apyBps: payload.apyBps,
    rangeHighBps: payload.rangeHighBps,
    rangeLowBps: payload.rangeLowBps,
  };
}

export async function fetchEarnForecastApy(): Promise<EarnForecastApy> {
  const now = Date.now();
  if (cachedForecast && cachedForecast.expiresAt > now) {
    return cachedForecast.value;
  }

  if (inflightForecast) {
    return inflightForecast;
  }

  inflightForecast = fetch("/api/smart-accounts/earn-forecast", {
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Earn forecast request failed: ${response.status}`);
      }

      return toForecastApy((await response.json()) as EarnForecastResponse);
    })
    .then((forecast) => {
      cachedForecast = {
        expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        value: forecast,
      };
      return forecast;
    })
    .catch((error) => {
      console.warn("[earn-forecast] failed to load forecast", error);
      cachedForecast = {
        expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        value: FALLBACK_EARN_APY,
      };
      return FALLBACK_EARN_APY;
    })
    .finally(() => {
      inflightForecast = null;
    });

  return inflightForecast;
}

export function resetEarnForecastApyCacheForTests() {
  cachedForecast = null;
  inflightForecast = null;
}

export function useEarnForecastApy(): EarnForecastApy {
  const [forecast, setForecast] =
    useState<EarnForecastApy>(cachedForecast?.value ?? FALLBACK_EARN_APY);

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
